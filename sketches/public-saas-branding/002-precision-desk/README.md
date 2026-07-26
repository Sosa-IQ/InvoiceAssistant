# 002 — Precision Desk (placeholder brand: **NORTHLINE**)

> ⚠️ **Branching concept.** "NORTHLINE" is a placeholder name to make the mockup
> credible. It is **not** an approved name, mark, or palette. Everything is open.

A single self-contained `index.html` (inline CSS, inline SVG, no build step, no
remote images). Google Fonts load with strong system fallbacks
(`Inter → system sans`, `IBM Plex Mono → SF Mono/Menlo/Consolas`).

## Design stance
Precision operations tool. Accounts receivable treated as a **queue you work**,
not a page you admire. Dark graphite native UI, dense but calm, built for
someone who lives in the product and wants throughput, keyboard reach, and
signal. Mono is used deliberately for IDs, dates, amounts, and metric readouts —
the "instrument panel" register — while Inter handles prose.

## Deliberately *not* Linear
Linear is the reference point everyone reaches for in dark ops UIs, so this
concept derives a **distinct receivables identity** instead of cloning it:
- A **North-star chevron mark** and split `NORTH·LINE` wordmark — a bearing, not
  an abstract shape.
- A **three-pane shell**: slim icon rail → contextual *queue* nav (Needs action /
  Awaiting / Overdue / Scheduled with live counts) → work area. The IA is built
  around **collections triage**, not issue tracking.
- Cyan/blue is a functional accent (status, focus, primary action), never
  decorative glow; green/amber/red carry real invoice states.
- The composer is a **right-hand drawer** with a mono line-item card — an
  operator's send-and-track panel, not a marketing modal.

## Key choices
- **Dense KPI strip** (Outstanding, Due ≤7d, Overdue, Paid 30d, DSO with a real
  sparkline) above a tight, tabular invoice queue with per-status filter chips.
- **Live activity feed** to the right — payments, reminders, escalations — so the
  operator sees state change without leaving the queue.
- Rows are fully keyboard-operable (`tabindex`, `Enter`/`Space` open the drawer).
- Interactions: open/close drawer, `Esc` to dismiss, status filters that update a
  live row count, auto-chase action, and a corner toast with mono metadata.
  Focus-visible rings, hover states, `prefers-reduced-motion`.

## Trade-offs
- **High density has a learning curve**; casual/first-time users may feel it's
  "for accountants."
- Dark-first means a light theme is extra work, and dark UIs can strain some
  users in bright environments.
- Mono numerals are precise but **consume horizontal space**; long client names
  get tighter than in the airier concepts.

## Best for
Agencies, ops managers, bookkeepers, and high-volume solo operators who process
many invoices and want a fast, information-rich control surface.

## Placeholder-name caveat
NORTHLINE, the chevron mark, and the graphite/cyan palette are illustrative
only and not approved. Treat them as a stance to react to, not a decision.
