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

Raw `npm audit` currently reports 10 vulnerability nodes: 3 moderate and 7
high. The package-node count is larger than the number of root advisories
because npm reports vulnerable transitive propagation chains separately.

CI runs `scripts/check-rsc-not-used.mjs` plus `scripts/npm-audit-policy.mjs`. The policy consumes npm's JSON schema, recursively validates propagation chains, fails on unrelated findings, and also fails when an exception expires or becomes stale after a fix.

Twenty-one findings were resolved by `npm audit fix`, which stayed inside the
existing caret ranges — no `package.json` range changed:

| Package | From | To |
| --- | --- | --- |
| `axios` | 1.13.5 | 1.18.1 |
| `react-router` / `react-router-dom` | 7.13.0 | 7.18.1 |
| `vite` | 7.3.1 | 7.3.6 |
| `rollup` | 4.x | 4.62.2 |

Transitive fixes came along for `postcss`, `brace-expansion`, `minimatch`,
`picomatch`, `form-data`, `js-yaml`, `flatted`, `qs`, `follow-redirects`,
`path-to-regexp`, `fast-uri`, `ajv`, `esbuild`, `body-parser`, `ip-address`
and `@babel/core`.

### Exact exception: React Router RSC APIs (`GHSA-qwww-vcr4-c8h2`)

- **Scope:** production and full dependency graphs.
- **Expiry:** 2026-10-22.
- **Why accepted:** the advisory affects unstable React Router Server
  Components APIs. This application is a browser-only Vite SPA and imports
  `react-router-dom`; it does not use React Router server/RSC entry points.
- **Fail-closed proof:** `check-rsc-not-used.mjs` rejects direct, re-exported,
  dynamic, `require`, namespace, computed, and template-literal RSC access,
  forbids server/RSC packages, requires `components.json` to keep `rsc=false`,
  and is itself covered by negative fixtures.
- **Removal trigger:** remove the exception when npm no longer reports the
  advisory on the installed production graph, or replace the dependency before
  the expiry date.

### Exact exception: ESLint brace-expansion chain (`GHSA-mh99-v99m-4gvg`)

- **Scope:** full graph only; it is absent from the production graph.
- **Expiry:** 2026-08-31.
- **Why accepted:** the affected `brace-expansion` path is reachable only while
  running ESLint. ESLint 10 was tested and is currently incompatible with the
  existing plugin/config chain; forcing it would break the lint gate.
- **Removal trigger:** move to a compatible ESLint/plugin chain or remove the
  exception before expiry. Production policy never accepts this advisory.

### Below-threshold exposure: `shadcn` MCP server chain

Three moderate advisories remain, all in one dev-only chain:

```
shadcn (devDependency) -> @modelcontextprotocol/sdk -> @hono/node-server <2.0.5
```

Not fixed, because:

- **No non-breaking fix exists.** The patch is in `@hono/node-server` 2.0.5,
  but `@modelcontextprotocol/sdk` declares `^1.19.9`. Forcing 2.x would push
  the SDK across a major boundary it does not claim to support — the exact
  blind override this policy prohibits. `npm audit fix` reports a fix is
  available but cannot apply one; its only real suggestion is downgrading
  `shadcn`, which does not remove the chain.
- **It is not shipped.** `shadcn` is build-time tooling. The app consumes only
  `shadcn/tailwind.css` (imported by `src/index.css`); no MCP or Hono code
  appears in `dist/`. Raw `npm audit --omit=dev` reports only the transitive
  React Router nodes covered by the exact exception above.
- **The vulnerable code never runs.** The advisories are in an HTTP server
  started by `shadcn mcp`, which this project does not invoke.

Note that `shadcn` cannot simply be removed: `src/index.css` imports its
stylesheet, so uninstalling it breaks the build.

The CI gate is calibrated to match this reasoning — production dependencies
fail the build at moderate, build tooling at high — so this exposure is
tolerated while a genuine production regression is not. Re-check when
`@modelcontextprotocol/sdk` moves to `@hono/node-server` 2.x.
