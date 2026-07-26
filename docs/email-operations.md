# Email operations

## Default composition templates

Each tenant can edit its default subject and message under **Settings → Email Templates**. New email compositions interpolate only these allowlisted placeholders:

- `{invoice_number}`
- `{client_name}`
- `{business_name}`
- `{issue_date}`
- `{total}`
- `{currency}`

Templates must be nonblank; subjects are limited to 200 characters and one line, and messages to 5,000 characters. Unknown or malformed placeholders are rejected. The rendered subject and message remain editable for an individual send without changing the saved tenant defaults.

## Reliability model

Each browser composition sends an `idempotency_key`. The API stores it under a per-user unique constraint and binds it to a SHA-256 fingerprint covering:

- invoice record
- recipient, CC, Reply-To, and sender display name
- subject and message
- attached PDF bytes

Behavior:

- replay after a successful send returns the original result without calling SMTP again;
- concurrent replay while an active attempt lease is `pending` returns `409` with `Retry-After`;
- changed content with an existing key returns `409`;
- retry after `failed` reuses the same database row and deterministic SMTP `Message-ID`;
- only `sent` rows appear in Send History.

SMTP cannot provide universal exactly-once delivery. A connection can fail after a remote server accepted the message but before it acknowledged the client. Reusing `Message-ID` gives downstream systems a stable duplicate identity, but provider behavior varies. Review the recipient/provider logs before repeatedly retrying an ambiguous timeout.

### Stale `pending` attempts

A process crash after SMTP accepts a message but before the final database commit leaves the attempt `pending`. Each attempt has a unique token and a 15-minute lease. An active lease blocks concurrent work; an expired lease remains intentionally fail-closed and requires reconciliation rather than risking an automatic duplicate.

1. With the owner's bearer token, list pending attempts using `GET /api/invoices/{invoice_id}/email-attempts/pending` and record the attempt ID and deterministic `provider_message_id`.
2. Search provider delivery logs and the recipient mailbox using that Message-ID.
3. After the lease expires, if delivery is confirmed, call `POST /api/invoices/{invoice_id}/email-attempts/{attempt_id}/reconcile` with `{"resolution":"delivered"}`; do not resend.
4. Only if delivery is conclusively ruled out, call the same endpoint with `{"resolution":"not_delivered"}`, then retry with the same idempotency key.
5. Preserve the original row, request ID, attempt count, and Message-ID for auditability.

The API scopes reconciliation to the authenticated owner and exact invoice/attempt row, row-locks the decision, rejects active or terminal attempts, and returns the reconciled row for read-back verification. It is still a production state change and requires explicit owner approval.

## No-send preflight

From `backend/`, with `.env` configured:

```bash
.venv/bin/python scripts/smtp_preflight.py
```

This checks DNS/TCP, EHLO, TLS, optional authentication, and SMTP `NOOP`. It does **not** specify a recipient and does **not** send mail. Use `--skip-auth` to test connectivity/TLS only.

The command never prints credentials or the provider's raw error text.

## Owner acceptance test

A real delivery test requires an owner-selected recipient. Use a disposable invoice and verify:

1. recipient gets one message and one PDF;
2. CC behavior matches the modal;
3. Reply-To routes correctly;
4. From display name is the business/sender name;
5. retrying the same completed request does not create a second email;
6. only successful sends appear in history.

Do not automate live sends in CI. CI uses a hermetic SMTP fake.
