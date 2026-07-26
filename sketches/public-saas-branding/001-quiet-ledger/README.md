# 001 — Quiet Ledger (placeholder brand: **DAYBOOK**)

> ⚠️ **Branching concept.** "DAYBOOK" is a placeholder name used only to make the
> mockup feel real. It is **not** an approved product name, logo, or trademark
> decision. Naming, wordmark, and palette are all still open.

A single self-contained `index.html` (inline CSS, inline SVG, no build step, no
remote images). Google Fonts are loaded with strong system fallbacks
(`Fraunces → Georgia/Times`, `Inter → system sans`).

## Design stance
Calm editorial finance. The product should feel like a well-kept paper ledger —
unhurried, literate, and content-first. Money is emotional; this stance lowers
the temperature. Generous whitespace, a warm ivory canvas, a restrained serif
display for headlines, and a clean sans for everything you actually operate.

## Key choices
- **Warm paper canvas** (`#f6f1e7`) with ink navy text and a single jade accent
  for "money is healthy" signals. Amber and rose carry due/overdue meaning only.
- **Serif display / sans body split.** Fraunces sets a human, editorial tone on
  headings, metric values, and amounts; Inter keeps the working UI legible.
- **Content-first dashboard.** Airy metric cards, a genuinely useful
  **receivables aging bar** (real proportions, labeled — not decorative), and a
  quiet "ledger" table. A thin left rail keeps navigation out of the way.
- **Composer as a centered modal** with a live invoice preview, prefilled with
  the Acme Studio / INV-1048 / $2,840 / due Aug 15 scenario.
- Interactions: open/close composer (button, row link, overlay click, `Esc`),
  status filter chips that re-render the table, and a bottom toast on
  send/save/remind. Focus-visible rings, hover states, `prefers-reduced-motion`.

## Trade-offs
- Airy layout means **lower information density** — power users managing hundreds
  of invoices will scroll more than in an ops-grid UI.
- A serif display is distinctive but **riskier at small sizes / poor rendering**;
  the system fallback is Georgia, which shifts the mood.
- The calm tone can read as "small/boutique," which may undersell scale.

## Best for
Freelancers, studios, accountants, and boutique service businesses who value
trust and calm over throughput — people who find most finance tools cold.

## Placeholder-name caveat
DAYBOOK is illustrative only. Do not treat the name, the open-book mark, or the
jade/ivory palette as decided. Everything here is a starting point for discussion.
