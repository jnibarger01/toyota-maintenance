# Toyota Maintenance Design Contract

## Source Of Truth
- Exact reference: local design reference image used during implementation (not committed).
- Product purpose: a customer-facing presentation of imported Toyota/Xtime factory maintenance schedule data.
- The interface may say `Factory schedule` and `Source: Xtime`. It must not claim live Toyota verification or quote an owner's manual unless that source exists in the data.

## Audience And Outcome
- Primary audience: a service advisor and customer viewing the same screen together.
- Primary question: what does the imported factory schedule list at the current mileage interval, and what interval comes next?
- Customer-safe output only: no VIN, personal data, prices, op codes, labor hours, hidden tasks, or internal advisor notes.

## Visual Direction
- Match the reference's compact, Xtime-like technical workstation: black title bar, dark left rail, white data canvas, blue active states, dense schedule grid, and a right-side task inspector.
- Keep the schedule grid visually dominant. Avoid generic analytics cards, gradients, glass, decorative vehicle imagery, and excess rounding.
- Use real data labels. Omit mockup-only fields such as Gas, No Mountains, Appointments, Customers, Reports, and Settings unless a real product behavior exists.

## Color Roles
- Hendrick blue: `#00558C` for active navigation, current interval, links, focus, and primary actions.
- Deep blue: `#003C63` for hover/pressed states.
- Black: `#000000` and near-black `#101215` for the title bar, rail, and primary text.
- White: `#FFFFFF` for the data canvas and controls.
- Blue tints: `#E6EFF5` and `#CFE0EB` for selected rows and the current interval column.
- Neutral tints: `#F4F5F6`, `#ECECEE`, `#D7D9DB`, and `#55595E` for backgrounds, borders, and secondary text.
- No third brand hue. Status meaning must use wording, icons, and contrast rather than red/amber/green.

## Typography And Icons
- Font: Montserrat when available, with system sans-serif fallbacks.
- Title bar: 21-24px, 800 weight, uppercase, modest tracking.
- Data/KPI numerals: tabular numerals, 24-32px, 800 weight.
- Grid: 13-15px with 600-700 weight for headings and 400-500 for task rows.
- Use one consistent outline icon library. Do not draw custom icons, inline SVG artwork, CSS art, emoji, or text glyph substitutes.

## Desktop Layout
- Target viewport for fidelity QA: 1672x941, matching the supplied reference frame.
- Top title bar: approximately 66px high.
- Left rail: approximately 108px wide, fixed within the app shell.
- Vehicle summary/filter strip: one compact row below the title bar.
- KPI and view-switch strip: approximately 92px high.
- Results body: grid and inspector in a roughly 4:1 split; inspector 320-365px wide.
- Grid task column remains sticky; current mileage column uses the strongest blue emphasis.

## Responsive Layout
- Below 1180px: collapse the left rail to icons/tooltips and place the inspector below the grid.
- Below 760px: stack title actions and KPI blocks; retain horizontal grid scrolling with sticky task names; keep all primary actions keyboard and touch reachable.
- No persistent control may be clipped or hidden by viewport overflow.

## Component Behavior
- Vehicle action opens or returns to the real year/model/details flow.
- Grid, List, and Owner's Guide are functional tabs backed by existing APIs.
- Grid categories expand and collapse; task rows select the customer-safe inspector.
- Inspector shows only factual schedule fields: task name, category, priority, scheduled mileages, source description when present, and print inclusion state.
- Print and Add/Remove from print sheet work against the current customer-safe selection.
- Loading, empty, retry/error, focus, selected, expanded, and disabled states are visibly designed.
- Source provenance is an informational badge, not a fake button.

## Accessibility And Quality Gates
- WCAG AA contrast, visible focus, semantic buttons/tabs/table headers, keyboard row selection, and reduced-motion support.
- Minimum 44px interactive targets where space permits.
- Design QA must compare the selected results state against the reference at 1672x941 and also check 1180px and 760px responsive behavior.
- Browser console must be clean during the primary selection, grid, list, guide, inspector, and print interactions.

## Agent Notes
- Preserve public endpoint paths; explicitly document intentional customer-safety response changes and their migration impact.
- Customer safety is enforced server-side and defended in the UI.
- Existing dirty changes belong to the user and must remain intact.
