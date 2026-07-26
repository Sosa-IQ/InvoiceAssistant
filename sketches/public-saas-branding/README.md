# Public SaaS Branding — Concept Exploration

Three **throwaway, self-contained** HTML branding/UI concepts for the public
(SaaS) face of the invoice product. These are exploration sketches, not
production code. **Nothing here touches `frontend/` or `backend/`, and nothing
here is an approved name, logo, or palette.**

Each folder holds one `index.html` (open it directly in a browser; no build
step, server, or remote images required), a `README.md` describing its stance,
and verified 1440×1000 dashboard and composer PNGs. The broader launch checklist
is in [`docs/public-saas-roadmap.md`](../../docs/public-saas-roadmap.md).

| # | Folder | Placeholder name | One-line stance |
|---|--------|------------------|-----------------|
| 001 | [`001-quiet-ledger/`](001-quiet-ledger/index.html) | **DAYBOOK** | Calm editorial finance — warm paper, serif display, airy & content-first |
| 002 | [`002-precision-desk/`](002-precision-desk/index.html) | **NORTHLINE** | Dark graphite ops tool — dense receivables queue, mono instrumentation |
| 003 | [`003-friendly-flow/`](003-friendly-flow/index.html) | **PEBBLE** | Warm founder-first — rounded geometry, plain language, encouraging |

> **Placeholder names.** DAYBOOK, NORTHLINE, and PEBBLE exist only to make the
> mockups feel real. They are not naming proposals or trademark decisions. Every
> `index.html` labels itself **BRANCHING CONCEPT / PLACEHOLDER NAME** on screen.

## Exported concept screens

| Direction | Dashboard | Composer |
|---|---|---|
| DAYBOOK | [View PNG](001-quiet-ledger/concept-dashboard.png) | [View PNG](001-quiet-ledger/concept-composer.png) |
| NORTHLINE | [View PNG](002-precision-desk/concept-dashboard.png) | [View PNG](002-precision-desk/concept-composer.png) |
| PEBBLE | [View PNG](003-friendly-flow/concept-dashboard.png) | [View PNG](003-friendly-flow/concept-composer.png) |

All six exports were rendered and visually checked at 1440×1000.

## Comparison matrix

Scored **1–5** (5 = strongest on that axis) as a discussion aid, not a verdict.

| Criterion | 001 DAYBOOK (Quiet Ledger) | 002 NORTHLINE (Precision Desk) | 003 PEBBLE (Friendly Flow) |
|---|---|---|---|
| **Trust / credibility** | 5 — editorial calm reads as established & careful | 4 — precise/technical reads as capable, can feel cold | 3 — warm & approachable, may read as less "serious" |
| **Information density** | 2 — airy, content-first, more scrolling | 5 — dense queue + KPI strip + live feed | 2 — big friendly rows, low density |
| **Friendliness / approachability** | 3 — pleasant but reserved | 2 — operator-focused, higher learning curve | 5 — encouraging, plain language, supportive |
| **Differentiation** | 4 — serif-led finance is uncommon in this space | 4 — deliberately derives a distinct AR identity (not Linear) | 4 — bold cream/forest/coral is memorable |
| **Mobile suitability** | 4 — single column & fluid; serif needs size care | 3 — dense UI compresses; rail collapses but tight | 5 — large targets & rounded cards adapt naturally |
| **Accessibility posture** | 4 — strong contrast, focus rings, reduced-motion | 4 — dark contrast tuned, keyboard rows, focus rings | 4 — thick focus rings, but coral/lime need contrast care |

### How to read this
Each concept intentionally optimizes a **different** first principle:

- **001** optimizes *calm and trust* at the cost of density.
- **002** optimizes *throughput and control* at the cost of approachability.
- **003** optimizes *reassurance and speed-to-send* at the cost of density.

They differ in **information architecture and component shape**, not just color:
a thin-rail editorial dashboard (001), a three-pane ops queue with drawer
composer (002), and a card-based founder home with modal composer (003).

### Recommendation criteria (decide by audience, not aesthetics)
- **Who is the primary buyer?** Boutique/professional (→001), high-volume
  ops/agency (→002), or stressed solo founder (→003)?
- **Density need:** how many invoices does a typical user manage at once?
- **Voice:** should the product feel authoritative, instrumental, or supportive?
- **Theme roadmap:** light-first (001/003) vs. dark-first (002) changes effort.
- **Brand risk tolerance:** serif display (001) and coral/lime (003) are more
  distinctive but demand more discipline than the graphite system (002).

**No winner is declared here** — this matrix is meant to structure a decision
with real users and stakeholders, not to make it.
