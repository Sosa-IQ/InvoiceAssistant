# 003 — Friendly Flow (placeholder brand: **PEBBLE**)

> ⚠️ **Branching concept.** "PEBBLE" is a placeholder name to make the mockup feel
> real. It is **not** an approved name, mark, or palette. All of it is open.

A single self-contained `index.html` (inline CSS, inline SVG, no build step, no
remote images). Google Fonts load with strong system fallbacks
(`Epilogue → system sans`, `Nunito Sans → system sans`).

## Design stance
Warm, encouraging, founder-first. Invoicing carries dread for solo operators, so
this concept is the *reassuring companion*: rounded geometry, a cream canvas,
deep forest for grounding, and coral + lime accents for energy. Bold and
confident — **rounded, not childish** (no emoji icons, no cartoon mascots; the
warmth comes from shape, color, and copy).

## Key choices
- **Forest sidebar as a card** with the user/business identity and a monthly
  **goal tracker** — the app is framed around *your* progress, not a ledger.
- **Big, legible metric cards** in plain language ("Waiting to be paid", "Paid
  this month") instead of finance jargon.
- **Invoices as friendly rows**, not a dense grid — avatar, plain-English status
  ("Due soon", "On track", "Overdue"), amount, and a single clear action whose
  label matches intent (Send / Nudge / View / Receipt).
- A **"Get paid faster"** right rail with one-tap quick actions and a positive
  reinforcement streak card — encouragement without gamified noise.
- Composer is a **rounded modal** with a warm note and a dashed "receipt"
  preview, prefilled with Acme Studio / INV-1048 / $2,840 / due Aug 15.
- Interactions: open/close composer (multiple entry points, overlay click,
  `Esc`), segmented status filter with an "Open = open + overdue" rule, and a
  center toast with warm confirmations. Focus-visible rings (thick forest),
  hover/translate states, `prefers-reduced-motion`.

## Trade-offs
- Warmth and larger touch targets mean **lower density**; not ideal for someone
  managing hundreds of invoices at once.
- A friendly voice risks reading as **less "serious"** to enterprise or finance-
  led buyers.
- Coral/lime is distinctive but **needs careful contrast discipline** to stay
  accessible; the accents must never carry text-critical meaning alone.

## Best for
Solo founders, freelancers, and very small businesses who find invoicing
stressful and want a tool that feels supportive and quick, not clerical.

## Placeholder-name caveat
PEBBLE, the stacked-pebble mark, and the cream/forest/coral/lime palette are
illustrative only and not approved. They exist to give the stance a face, not to
propose a final identity.
