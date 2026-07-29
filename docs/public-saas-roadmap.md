# Public SaaS launch roadmap

Status: planning

This document tracks the work required to move Invoice Assistant from a private/internal tool to a public SaaS product. It does not authorize public exposure, billing, production migration, or deployment.

## Release boundaries

### Private/internal release

The application code can move into a controlled internal deployment once the private hosting, migration, enrollment, recovery, and monitoring gates are complete. Private readiness does not imply public SaaS readiness.

### Public beta

A public beta requires safe account lifecycle, admission and abuse controls, correct data deletion and recovery, legal disclosures, support paths, and production operations. Billing is optional only if the beta is intentionally free and bounded by explicit quotas.

### Paid public release

A paid release additionally requires billing, subscription state, server-enforced entitlements, usage accounting, tax/refund decisions, and customer billing operations.

## P0: public launch blockers

### Product identity and positioning

- [ ] Define the primary customer segment and first use case.
- [ ] Write a one-sentence positioning statement and product promise.
- [ ] Select a product name after domain, app-store, social-handle, and trademark screening.
- [ ] Define voice and terminology for invoices, clients, catalog items, drafts, sends, and account limits.
- [ ] Approve a visual direction: logo, mark, typography, color system, icon style, spacing, and motion principles.
- [ ] Produce light and dark application themes with accessible contrast.
- [ ] Create responsive logo variants, favicon/app icon, email mark, and social preview assets.
- [ ] Apply the selected identity to authentication, onboarding, dashboard, invoice editor, email flow, settings, pricing, and transactional email.
- [ ] Replace the placeholder "Invoice Assistant" identity only after the new name is approved.

Acceptance criteria:

- The name passes a documented clearance check.
- Brand assets remain legible at favicon, mobile-header, and email sizes.
- Core screens pass WCAG AA contrast and keyboard-focus review.
- Product copy consistently uses the approved vocabulary.

### Production hosting and domain

- [ ] Choose the production frontend, backend, and worker/runtime topology.
- [ ] Make the frontend API base URL environment-configurable.
- [ ] Configure exact production and staging origins in CORS, or use a tested same-origin reverse proxy.
- [ ] Add reproducible deployment artifacts and commands.
- [ ] Configure DNS, TLS, SPA fallback routing, health probes, restart policy, and rollback.
- [ ] Store production secrets in a managed secret store; document rotation and emergency revocation.
- [ ] Separate development, staging, and production environments and data.
- [ ] Verify CSP, HSTS, frame restrictions, referrer policy, content-type protection, and permissions policy at the edge.

Acceptance criteria:

- A clean checkout can produce the exact release artifact.
- Staging and production use separate credentials and databases.
- A failed release can be rolled back without data loss.
- Health and readiness failures prevent bad instances from receiving traffic.

### Account lifecycle and admission controls

- [ ] Decide between invite-only beta, waitlist, or open registration.
- [ ] Require email verification before metered or sensitive actions.
- [ ] Add forgot-password and password-reset flows.
- [ ] Add session/device management and account-security notifications where supported.
- [ ] Add account deletion with explicit consequences and a cooling-off/confirmation policy.
- [ ] Add complete account-data export.
- [ ] Add bot protection and signup throttling.
- [ ] Define suspension, abuse review, appeal, and reactivation behavior.
- [ ] Verify Supabase JWT issuer, audience, expiry, and role validation for production.

Acceptance criteria:

- A user can recover, export, and delete their account without manual database intervention.
- Account deletion removes or schedules deletion of database rows, Storage objects, generated documents, vectors, email metadata, and provider-side artifacts where possible.
- Unverified or suspended accounts cannot consume metered providers.

### Billing, plans, and entitlements

- [ ] Define the free/trial and paid plans.
- [ ] Decide which capabilities are limited: invoices, clients, AI generations, storage, email sends, transcription, team seats, branding, exports, and support.
- [ ] Define monthly quotas, burst limits, overage behavior, and reset timing.
- [ ] Add Stripe products/prices, Checkout, customer portal, and customer mapping.
- [ ] Verify and idempotently process subscription webhooks.
- [ ] Persist normalized subscription and entitlement state.
- [ ] Enforce entitlements in the backend; UI gating is informational only.
- [ ] Add usage accounting and an in-product usage meter.
- [ ] Handle trials, upgrades, downgrades, cancellation, failed payments, grace periods, refunds, and deleted Stripe customers.
- [ ] Decide tax, invoicing, and merchant-of-record responsibilities.
- [ ] Build owner support procedures for billing disputes and webhook reconciliation.

Acceptance criteria:

- Direct API calls cannot bypass plan limits.
- Replayed/out-of-order webhooks cannot corrupt entitlement state.
- A failed payment produces the documented grace/restriction behavior without deleting customer data.

### Abuse and cost controls

- [ ] Add durable per-account limits for transcription, uploads, embeddings/RAG, PDF work, and all AI-generation paths.
- [ ] Add request-size, file-count, storage, concurrency, and time limits.
- [ ] Add global/provider circuit breakers and budget alerts.
- [ ] Prevent free-account multiplication from trivially bypassing quotas.
- [ ] Validate file types by content, not only filename or browser MIME type.
- [ ] Define malware/scanning policy for uploaded documents.
- [ ] Record privacy-safe security events for blocked and suspicious actions.

Acceptance criteria:

- Every metered provider path has a durable limit and test proving the provider is not called after denial.
- Operators can disable a costly feature without deploying new code.

### Data deletion, retention, and recovery

- [ ] Delete Supabase Storage PDFs when invoices are deleted; do not leave orphaned objects.
- [ ] Define retention for invoices, email history, security events, logs, backups, deleted accounts, and failed uploads.
- [ ] Implement and test complete tenant deletion.
- [ ] Configure encrypted off-host PostgreSQL backups.
- [ ] Configure Supabase Storage backup/replication; database dumps do not include stored PDFs.
- [ ] Run deployment-environment restore drills covering PostgreSQL and Storage consistency.
- [ ] Define RPO/RTO for public customers and document restore ownership.
- [ ] Add backup failure and stale-backup alerts.

Acceptance criteria:

- A restore recovers database and Storage objects to a consistent point.
- Deletion tests prove tenant data and objects are gone or retained only under a documented legal requirement.

### Legal, privacy, and customer-facing policy

- [ ] Publish Terms of Service and Privacy Notice reviewed for the actual data flows.
- [ ] Document subprocessors and provider data handling.
- [ ] Publish retention, deletion, acceptable-use, and refund/cancellation policies.
- [ ] Decide cookie/analytics consent behavior based on the chosen tooling and jurisdictions.
- [ ] Publish a support/contact channel and response expectations.
- [ ] Add required policy acceptance and version tracking during signup when advised.
- [ ] Document procedures for privacy/data-subject requests.

Acceptance criteria:

- Public copy matches actual application and provider behavior.
- Support can locate the policy version accepted by an account when required.

### Production operations

- [ ] Configure privacy-scrubbed Sentry in staging and verify a controlled event contains no invoice, email, token, cookie, or local-variable data.
- [ ] Configure uptime checks for liveness, readiness, frontend, and critical dependencies.
- [ ] Define alerts, dashboards, escalation, and incident ownership.
- [ ] Add release, rollback, migration, SMTP, provider-outage, reconciliation, and credential-rotation runbooks.
- [ ] Define log retention and access controls.
- [ ] Add provider status and budget monitoring.
- [ ] Create a customer incident/status communication path.

Acceptance criteria:

- A controlled staging failure pages/notifies the intended owner.
- Operators can identify the release, request ID, dependency, and remediation without exposing customer content.

## P1: required before charging customers

### Security and sensitive data

- [ ] Review whether bank/routing fields should exist in the product.
- [ ] If retained, define field-level encryption, masking, access logging, retention, backup handling, and support visibility.
- [ ] Complete a threat model covering auth, RLS, Storage, email, PDFs, billing webhooks, AI providers, and admin tooling.
- [ ] Add dependency update ownership and exception-expiry monitoring.
- [ ] Run an external security review or targeted penetration test before broad launch.

### Customer support and administration

- [ ] Build minimal admin/support tools with audited, least-privilege access.
- [ ] Add safe account lookup without exposing cross-tenant invoice content by default.
- [ ] Add subscription, quota, reconciliation, and account-status support workflows.
- [ ] Define impersonation policy; avoid silent unrestricted impersonation.
- [ ] Add internal audit trails for support actions.

### Product experience

- [ ] Design onboarding and first-invoice guidance.
- [ ] Add purposeful empty, loading, error, offline, quota, payment, and provider-outage states.
- [ ] Add pricing, upgrade, downgrade, cancellation, billing-status, and usage screens.
- [ ] Add plan-aware feature explanations instead of unexplained disabled controls.
- [ ] Test desktop, tablet, and mobile layouts across supported browsers.
- [ ] Complete keyboard, screen-reader, reduced-motion, contrast, zoom, and error-message QA.
- [ ] Define product analytics events and collect only what is needed.

## P2: operational maturity

- [ ] Publish SLOs and customer-facing support expectations.
- [ ] Automate recurring database and Storage restore drills.
- [ ] Add data-consistency and orphaned-object checks.
- [ ] Add capacity/load testing for API, database, PDF, email, and AI-provider bottlenecks.
- [ ] Add churn, trial-conversion, failed-payment, and quota-pressure reporting.
- [ ] Establish release trains, change approval, and post-incident review procedures.
- [ ] Review regional data residency and compliance needs if the customer base expands.

## Recommended sequence

1. Approve positioning and one visual direction.
2. Decide private beta admission and production hosting topology.
3. Fix public data lifecycle and metered-provider controls.
4. Build account lifecycle and production operations.
5. Define plans and implement backend entitlements.
6. Add Stripe and billing operations.
7. Complete legal copy and support paths.
8. Run staged security, recovery, accessibility, provider, and billing acceptance.
9. Launch an invite-only beta with conservative quotas.
10. Expand access only after observing cost, support, abuse, and reliability behavior.

## Open product decisions

- [ ] Who is the first customer: solo consultant, small agency, contractor, or finance operations team?
- [ ] Is AI generation the product's headline or a supporting accelerator?
- [ ] Is the first public release invite-only, free beta, trial, or paid from day one?
- [ ] Are bank account and routing fields necessary, or should payment instructions use safer provider-hosted links?
- [ ] Will customers send through a platform email identity or connect their own sender/domain?
- [ ] Are teams/multiple seats part of v1 pricing or deferred?
- [ ] Which usage unit is easiest for customers to understand and for the system to enforce?

## Definition of public launch ready

Public launch is ready only when every P0 item is complete or has a written, owner-approved exception with scope, expiry, monitoring, and rollback. The release must also pass:

- production build and full automated suites;
- migration and fresh-schema parity;
- direct tenant-isolation and Storage-policy verification;
- secret and dependency scans;
- billing webhook replay/out-of-order tests;
- account deletion/export acceptance;
- database plus Storage recovery drill;
- desktop/mobile/accessibility QA;
- SMTP/provider delivery and reconciliation acceptance;
- production security-header and domain/TLS checks;
- independent security, accessibility, and release review.
