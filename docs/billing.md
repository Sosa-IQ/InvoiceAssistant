# Stripe subscription setup

Invoice Assistant supports a single configurable **Pro** subscription through Stripe Checkout and the Stripe customer portal. The Free plan remains available without Stripe.

The implementation does not trust the browser for prices, plan state, redirect URLs, or entitlements:

- the `/plans` catalog for a configured Pro price is built from the live Stripe Price (amount, currency, interval), validated as active/recurring with an integer amount and supported interval — never from `STRIPE_PRO_PRICE_CENTS`/`STRIPE_CURRENCY`, which are only a fallback display when billing is disabled;
- the backend owns the Stripe Price ID and Checkout parameters;
- Stripe webhook signatures are verified against the raw request body, which is bounded to 1 MiB (including chunked requests) before parsing;
- each event's `livemode` must equal `STRIPE_EXPECTED_LIVEMODE`, and `STRIPE_SECRET_KEY`'s mode (`sk_test_`/`sk_live_`) is validated against it at startup;
- processed event IDs are stored for idempotency, and the state change plus the ledger insert commit together, so a 2xx is returned only after durable acceptance and concurrent duplicates collide on the event id;
- subscription events grant Pro only when they map to an **existing** local subscription row (customer/subscription/user consistent) and the subscription carries exactly the configured Pro Price; a tenant is never created or chosen from event metadata;
- created/updated events reconcile against Stripe's authoritative current subscription state (so out-of-order events converge); deleted events use the signed snapshot with terminal/order protection;
- older events cannot overwrite newer subscription state;
- Checkout customer and session creation use Stripe idempotency keys (the session key persisted before the provider call and rotated on a 1-hour TTL, with `expires_at` aligned to it) so retries cannot duplicate provider resources or strand users on an expired session;
- subscription rows are tenant-scoped and only Stripe-backed `active`/`trialing` states unlock Pro when enforcement is enabled;
- Checkout and portal redirects are accepted by the frontend only on HTTPS Stripe domains.

## Current plan boundary

No new invoice or payment-tracking features are introduced.

- **Free:** manual invoices, clients, catalog, PDF export, and bulk PDF import (stored without embeddings).
- **Pro ($12/mo or $120/yr; launch promo $9/mo for 3 months when configured in Stripe):** email delivery, AI generate/revise, voice transcription, automatic embeddings for smart suggestions.
- **AI usage:** metered by tokens (generate + revise share one monthly pool). UI shows a plain usage bar plus “How usage works.” Monthly included allotment does **not** roll over.
- **Voice usage:** metered by audio seconds, with per-clip duration/size caps and hourly request limits.
- **Top-up packs (Pro only):** one-time Stripe Checkout payments. Pack balances **roll until used**, but are **frozen** (not deleted) when Pro ends and unfreeze on resubscribe. Spend order: included monthly first, then packs.
- **Embeddings:** Pro-only. Free imports/saves stay stored; on Free→Pro upgrade, prior invoices are backfilled automatically. Pro auto-indexes on save/update.

`BILLING_ENFORCEMENT_ENABLED` defaults to `false`, so adding Stripe test credentials does not unexpectedly block existing users. When enforcement is off, metering still records usage but does not hard-block by quota.

## 1. Apply the schema

```bash
cd backend
.venv/bin/alembic upgrade head
.venv/bin/alembic current
```

The expected head is `0011_usage_metering`. This includes `subscriptions`, the private `stripe_webhook_events` ledger, `usage_events`, and `usage_pack_credits`.

## 2. Create a test product and recurring price

Use Stripe **test mode**. In the Stripe Dashboard, create one product named `Invoice Assistant Pro` and one monthly recurring price. Record the resulting `price_...` ID. Stripe documents the Dashboard as the canonical pricing-model path; it also avoids shell-specific nested-parameter quoting.

Once `STRIPE_PRO_PRICE_ID` is configured, the `/plans` catalog reads the amount, currency, and interval directly from that Stripe Price, so the displayed price always matches what Stripe charges. `STRIPE_PRO_PRICE_CENTS` and `STRIPE_CURRENCY` are used only as a fallback display when billing is disabled (all three Stripe identifiers blank); they never override the live Price.

## 3. Configure the backend

Add test values to `backend/.env`:

```dotenv
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
STRIPE_PRO_PRICE_ID=price_REPLACE_ME
STRIPE_PRO_PRICE_CENTS=1200
STRIPE_CURRENCY=USD
STRIPE_EXPECTED_LIVEMODE=false
FRONTEND_URL=http://localhost:5173
BILLING_ENFORCEMENT_ENABLED=false
```

All three Stripe identifiers must be present before the app reports billing as configured. Never put `sk_...` or `whsec_...` values in the frontend environment.

`STRIPE_EXPECTED_LIVEMODE` must match the mode of `STRIPE_SECRET_KEY`: keep it `false` with a `sk_test_` key, and set it `true` only with a `sk_live_` key. The app refuses to start on a mismatch, and any webhook event whose `livemode` flag disagrees is rejected before it can touch subscription state.

For production, `FRONTEND_URL` must be the public HTTPS frontend origin whenever Stripe is configured.

## 4. Forward and verify local webhooks

Start the backend, then run:

```bash
stripe listen \
  --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted \
  --forward-to http://localhost:8000/api/billing/webhook
```

Copy the `whsec_...` secret printed by `stripe listen` into `backend/.env` as `STRIPE_WEBHOOK_SECRET`, then restart the backend. The CLI signing secret is for local forwarding; the production Dashboard endpoint has its own signing secret.

## 5. Configure the customer portal

In Stripe test mode, open **Billing → Customer portal** and configure the subscription-management options you intend to allow. The app creates portal sessions server-side and returns customers to `${FRONTEND_URL}/billing`.

## 6. Exercise the complete test flow

1. Start backend and frontend.
2. Sign up with a test user and complete the three onboarding steps.
3. Open `/pricing`; confirm the Pro price matches the Stripe test price.
4. Choose Pro and complete Checkout with Stripe's test card `4242 4242 4242 4242`, any future expiry, and any CVC.
5. Keep `stripe listen` running and confirm a subscription webhook reaches the backend with HTTP 200.
6. Return to `/billing` and confirm the plan changes from Free to Pro.
7. Open **Manage subscription** and verify the Stripe portal opens.
8. Cancel in the test portal; confirm the cancellation/end-of-period state returns through the webhook and appears in `/billing`.
9. Replay one event with the Stripe CLI or Dashboard and confirm the endpoint returns success without duplicating or regressing state.

Only after this full test-mode flow succeeds should `BILLING_ENFORCEMENT_ENABLED=true` be considered. Enabling it makes AI generation, voice transcription, and invoice email delivery return HTTP 402 for users without an active/trialing Pro subscription.

## Production webhook

Create a Stripe Dashboard webhook endpoint at:

```text
https://YOUR_API_HOST/api/billing/webhook
```

Subscribe to:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `checkout.session.completed` (required for one-time usage pack purchases)

Put that endpoint's production `whsec_...` value in the production backend secret store. Use live-mode `sk_live_...` and `price_...` values only after test-mode verification and explicit release approval, and set `STRIPE_EXPECTED_LIVEMODE=true` at the same time so live events are accepted and stray test events are rejected.

## Usage packs (optional)

Create two one-time (non-recurring) Prices in Stripe test mode, e.g.:

- AI top-up → set `STRIPE_AI_PACK_PRICE_ID` (credits `AI_PACK_TOKENS`, default 1_000_000)
- Voice top-up → set `STRIPE_VOICE_PACK_PRICE_ID` (credits `VOICE_PACK_SECONDS`, default 3600)

Pack Checkout is Pro-only. Webhook `checkout.session.completed` with `mode=payment` and metadata `pack_kind` credits the tenant. Losing Pro freezes pack spend; balances are preserved for resubscribe.

## Safe rollback

To disable plan gating without deleting billing history:

```dotenv
BILLING_ENFORCEMENT_ENABLED=false
```

Restart the backend and verify Free users can again access the existing assisted features. Do not downgrade migration `0010_billing` after real subscriptions exist; that would delete subscription and webhook-event records.

## References

- [Stripe Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions)
- [Subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Stripe CLI](https://docs.stripe.com/stripe-cli/use-cli)
- [Customer portal](https://docs.stripe.com/customer-management)
