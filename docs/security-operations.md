# Security operations

## Rate limits and audit events

PostgreSQL-backed, advisory-locked counters enforce per-user limits across API instances:

- email sends: 10 attempts per 600 seconds;
- AI invoice generation: 20 attempts per 3600 seconds.

Configure with `EMAIL_SEND_LIMIT`, `EMAIL_SEND_WINDOW_SECONDS`, `INVOICE_GENERATION_LIMIT`, and `INVOICE_GENERATION_WINDOW_SECONDS`. Blocked calls return `429` and `Retry-After` before SMTP/OpenAI execution.

`security_events` is append-only to authenticated users: they can select only their own events via RLS and receive no update/delete grant. Events store only user ID, controlled event type, allowed/blocked outcome, request ID, and timestamp—never prompts, addresses, message bodies, credentials, or provider responses.

## SMTP safety and rotation

Startup rejects partial SMTP credentials, missing From addresses when SMTP is enabled, plaintext SMTP in production, and non-positive limits.

Rotation procedure:

1. Create a new provider credential without revoking the old one.
2. Inject it through the deployment secret manager/environment; never commit it or store it in the database.
3. Restart the API and run `backend/scripts/smtp_preflight.py`.
4. Perform one owner-approved canary delivery and verify recipient, CC, Reply-To, attachment, and history.
5. Monitor authentication/send failures.
6. Revoke the old credential only after the canary succeeds.
7. Record operator/date/result outside application logs without recording the secret.

Rotate Supabase service-role, OpenAI, Speechmatics, JWT, SMTP, and database credentials immediately after suspected disclosure. Take a protected backup first when database credential rotation could affect access.

## Incident response

1. Disable the affected integration or private application ingress.
2. Preserve structured logs, request IDs, `security_events`, and email status rows.
3. Revoke/rotate exposed credentials.
4. Review rate-limit blocks, authentication failures, unexpected recipients, storage access, and database changes.
5. Restore only into an isolated target using `docs/recovery.md`.
6. Validate tenant isolation before reopening access.
7. Document scope, timeline, remediation, and follow-up controls.

## Dependency exceptions

CI accepts only declarative exceptions in `frontend/security/npm-audit-exceptions.json`. Each exception has an exact GHSA URL, root advisory package, propagation-package allowlist, severity, scope, and expiry. A clean report intentionally fails until a stale exception is removed.

The React Router exception additionally requires the tracked-source RSC guard to prove the app remains a browser-only Vite SPA. No exception suppresses a package wholesale or parses human-readable audit output.
