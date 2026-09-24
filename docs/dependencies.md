# Dependency security

Both stacks are audited in CI on every push and pull request. This file records
how upgrades are chosen, the two exact high-severity exceptions currently
accepted, and the below-threshold moderate development-tool exposure.

## Policy

Upgrade what an advisory actually names, plus whatever constrains it. Do not
run `npm audit fix --force` or bump every pin to latest: a force upgrade across
a major boundary trades a known, scoped vulnerability for an unknown breakage,
and it hides which change was security-relevant.

For each finding:

1. Prefer a patch or minor release on the current major.
2. If the fix needs a major bump, upgrade the package that *constrains* it
   rather than overriding the transitive dependency past what its parent
   declares support for.
3. If neither is possible, record the exposure below with the reason.

Every upgrade is verified by the full backend suite, the frontend build, and
lint before it lands.

## Backend

`pip-audit` runs against `requirements.txt` and `requirements-dev.txt`:

```bash
cd backend
.venv/bin/pip-audit --strict -r requirements.txt -r requirements-dev.txt
```

**Status: no known vulnerabilities.**

The following were remediated:

| Package | From | To | Notes |
| --- | --- | --- | --- |
| `starlette` | 0.41.3 | 1.3.1 | Nine advisories. Now pinned directly because it, not FastAPI, carries them. |
| `fastapi` | 0.115.6 | 0.139.2 | Not itself vulnerable. Upgraded because 0.115.x pins `starlette<0.42` and blocked the fix. |
| `PyJWT` | 2.10.1 | 2.13.0 | Eleven advisories in token validation — directly on the auth path. |
| `python-multipart` | 0.0.19 | 0.0.32 | Six advisories; upload parsing. |
| `weasyprint` | 63.1 | 69.0 | PDF rendering; covered by `test_pdf_generator.py`, which asserts real PDF bytes. |
| `pdfplumber` | 0.11.4 | 0.11.10 | Pulls `pdfminer.six` 20260107, which carries the parser fixes. |
| `jinja2` | 3.1.5 | 3.1.6 | Template rendering. |
| `python-dotenv` | 1.0.1 | 1.2.2 | Config loading. |

Packages with no advisories — `uvicorn`, `sqlalchemy`, `asyncpg`, `openai`,
`httpx`, `pydantic`, `pydantic-settings` — were deliberately left at their
existing pins.

## Frontend

```bash
cd frontend
node scripts/check-rsc-not-used.mjs
node scripts/npm-audit-policy.mjs --production  # production threshold: moderate
node scripts/npm-audit-policy.mjs               # full graph threshold: high
```

**Status:** all findings at the configured thresholds are either blocking or covered by exact, expiring, machine-validated exceptions in `frontend/security/npm-audit-exceptions.json`.

**Status (2026-09-24):** `npm audit` reports 0 vulnerabilities on both the
production and full graphs, and `frontend/security/npm-audit-exceptions.json`
holds no exceptions.

CI runs `scripts/check-rsc-not-used.mjs` plus `scripts/npm-audit-policy.mjs`. The policy consumes npm's JSON schema, recursively validates propagation chains, fails on unrelated findings, and also fails when an exception expires or becomes stale after a fix.

The latest refresh was a lockfile-only `npm update`: every bump stayed inside
the existing `package.json` ranges. It resolved the advisories that previously
failed the full-graph gate:

| Package | From | To |
| --- | --- | --- |
| `react-router` / `react-router-dom` | 7.18.1 | 7.18.4 |
| `vitest` / `@vitest/mocker` | 4.1.10 | 4.1.11 |
| `undici` | 7.28.0 | 7.29.1 |
| `browserslist` | 4.28.1 | 4.29.1 |
| `fast-uri` | 3.1.4 | 3.1.8 |
| `ip-address` | 10.2.0 | 10.7.2 |
| `js-yaml` | 4.3.0 | 4.3.2 |
| `nanoid` | 3.3.16 | 3.3.19 |
| `postcss` | 8.5.22 | 8.5.28 |
| `hono` | 4.12.31 | 4.13.9 |
| `qs` | 6.15.3 | 6.16.0 |

`brace-expansion` / `minimatch` under ESLint moved to patched releases, and
`@modelcontextprotocol/sdk` now resolves `@hono/node-server` 2.x, which clears
the dev-only `shadcn` MCP chain.

That retired both earlier exceptions: `GHSA-qwww-vcr4-c8h2` (React Router RSC
APIs) and `GHSA-mh99-v99m-4gvg` (ESLint brace-expansion chain). The RSC guard
still runs in CI as defense in depth.

`eslint-plugin-react-hooks` is held at 7.0.1 in the lockfile. 7.1.x adds an
error-level `react-hooks/set-state-in-effect` rule that the current code
violates; refactoring those effects is separate work, and the plugin carries
no advisory.
