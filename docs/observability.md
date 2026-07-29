# Observability

## Health checks

- `GET /health/live` proves the API process can answer HTTP. It deliberately does not contact PostgreSQL, Supabase Storage, OpenAI, or SMTP.
- `GET /health/ready` executes `SELECT 1` against PostgreSQL. It returns `200 {"status":"ready"}` or `503 {"status":"not_ready"}`.
- Every response includes `X-Request-ID`. A caller may supply an ID containing 1–128 letters, digits, `.`, `_`, or `-`; unsafe values are replaced.

Recommended probes:

```bash
curl --fail https://YOUR_API/health/live
curl --fail https://YOUR_API/health/ready
```

Use liveness for process restarts and readiness for load-balancer routing. Do not restart solely because an external AI or SMTP provider is unavailable.

## Structured logs

Application logs are JSON. Request completion records contain only:

- request ID
- HTTP method
- URL path (never the query string)
- status code
- duration
- exception type, when applicable

Request/response bodies, authorization headers, cookies, client IPs, invoice content, email content, and tokens are never added by the request logger.

Set `LOG_LEVEL` and ship stdout/stderr with the deployment platform's log collector.

## Optional Sentry

Set `SENTRY_DSN` to enable centralized backend error capture. Defaults are privacy-safe:

- `send_default_pii=false`
- request body capture disabled
- authorization/cookie headers removed by `before_send`
- user objects removed
- performance traces disabled unless `SENTRY_TRACES_SAMPLE_RATE` is explicitly increased

Set `APP_ENVIRONMENT` to distinguish `development`, `staging`, and `production`. After configuring a DSN, verify with a controlled staging error and confirm the event contains no body, token, cookie, email address, or invoice data before enabling production alerts.
