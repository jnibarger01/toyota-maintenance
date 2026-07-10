# Design QA — Customer Maintenance Cockpit

## Scope

- Reference: `/home/jacen/.codex/generated_images/019f493a-f598-7882-9529-ad5c4249a6fe/exec-28ea9528-0c40-4585-b137-9bcfa97fb1a0.png`
- Implementation: `/tmp/toyota-maintenance-cockpit-final-1672x940-v2.png`
- Full comparison: `/tmp/toyota-maintenance-cockpit-comparison-1672x940-v2.png`
- Focused grid/inspector comparison: `/tmp/toyota-maintenance-cockpit-comparison-grid-inspector-v2.png`
- Compared state: 2020 Toyota 4Runner SR5, V6 4.0L, automatic, 4WD,
  Normal schedule, 70,000 miles, grid view
- Reference viewport: 1672 × 941
- Normalized implementation viewport: 1672 × 940
- Responsive checks: 1180 × 900 and 760 × 900

The supplied concept is the visual source of truth. Imported schedule facts,
customer-safety rules, and working navigation remain the behavioral source of
truth; unsupported concept copy or dead navigation was not copied.

## Comparison history

### Pass 1

- P0: none.
- P1: none.
- P2: the full 0–120,000-mile timeline initially opened at its left edge, so
  the selected 70,000-mile interval was not visible without a manual jump.
- P2: narrow mileage columns showed too many intervals at once and weakened the
  reference's clear current/next interval hierarchy.
- P3: the implementation's dealership header and rail are more compact than the
  concept. This is intentional: only working destinations are present.

Fixes: the grid now scrolls the current interval into view after load (falling
back to the next interval), and data columns have a 128 px minimum width so the
visible interval density matches the reference more closely.

### Pass 2

- P0: none.
- P1: none.
- P2: none remaining.
- P3: exact typography and row density differ because the implementation uses
  the real Toyota schedule and factual task inspector. The reference's invented
  benefits, included-work claims, and unsupported navigation were deliberately
  omitted.

The final composition preserves the reference hierarchy: black product header,
dark left rail, white work surface, blue current interval, next-interval state,
horizontal maintenance matrix, grouped task rows, and right-side task details.

### Pass 3 — final interaction/accessibility audit

- P1: unconstrained grid height prevented the mileage header from remaining
  sticky during vertical task scrolling. The grid now has its own bounded
  scroll region and the header was measured at the scroller top after a
  500-pixel vertical scroll.
- P1: full-width category rows disappeared to the left after timeline
  centering. Category labels now occupy the same sticky first column as tasks.
- P2: local development prefilled arbitrary mileage values. Mileage and monthly
  mileage now start blank in every environment.
- P2: malformed `view` values silently rendered Grid. They now produce a
  friendly recovery state while retaining the invalid URL for diagnosis.
- P2: empty grid cells and required chip groups used invalid ARIA. Empty-cell
  text is now visually hidden content, prohibited attributes were removed, and
  route changes focus the main content landmark.

After these fixes, the live 1672 × 940 schedule opened with 70,000 miles centered
in the visible data viewport (measured center delta 0), a sticky category/task
column, a sticky mileage header, and 0 invalid empty-cell `aria-label`
attributes. Cockpit and print-route transitions focused their main landmarks.

## Interaction and console QA

- Direct entry verified for cockpit, year/model, vehicle, dimension-query
  schedule, configuration-key schedule, and print routes.
- Browser back, forward, and refresh restored the URL-derived selection.
- Invalid year, model, configuration key, and mileage each rendered a friendly
  recovery state.
- The grid represented 0 through 120,000 miles, scrolled horizontally, kept the
  header and task column sticky, highlighted current and next intervals, and
  updated the inspector and URL after task selection.
- Current/next jump controls and the explicit print-preview flow worked.
- At 1180 × 900 and 760 × 900, the page had no horizontal body overflow; the
  schedule grid remained contained and the inspector stacked below it.
- No application-origin browser console warnings or errors were observed.

## Result

final result: passed
