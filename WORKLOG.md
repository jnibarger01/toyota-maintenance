# Toyota Maintenance — Final Worklog

## Final state

The React/Vite cockpit now uses URL-derived navigation and exact imported
configuration resolution. The 2020 4Runner is one model entry whose trim,
engine, transmission, drivetrain, condition, and mileage are selected on a
separate vehicle page. Schedule pages expose the full published timeline with a
0–120,000-mile navigation baseline, factual task details, and a dedicated print
preview.

No Toyota/Xtime vehicle or maintenance facts were invented. The full available
export starts in 2001, so authentic year-2000 data remains unavailable and is
reported as a coverage error in strict validation.

## Architecture

```text
Xtime export JSONL
  ├─ streaming fail-closed ETL ──> read-only SQLite ──> Fastify API ──> React/Vite
  └─ catalog importer/validator ──> compact offline catalog/audit report
```

- Runtime schedule lookup stays in SQLite; the 645 MB source payload and the
  2.38 GB SQLite database are not bundled into Vite.
- The generated catalog is an audited, compact metadata artifact. It contains
  normalized vehicle/configuration identifiers and counts, not raw schedules,
  task edges, customers, VINs, prices, labor hours, or operation codes.
- The router, exact-key endpoint, and full-grid mode are additive. The cumulative
  working-tree diff also contains intentional customer-safety hardening from the
  preceding presentation pass; its compatibility impact is documented below.

## Route map

| Route | Behavior |
| --- | --- |
| `/` | Replace-redirects to `/cockpit` |
| `/cockpit` | Model-year selection |
| `/cockpit/:year` | One card per distinct imported model |
| `/vehicle/:year/:modelSlug` | Cascading physical-configuration selection |
| `/schedule/:year/:modelSlug` | Exact dimension-query schedule deep link |
| `/schedule/:year/:modelSlug/:configId` | Exact configuration-key schedule deep link |
| `/schedule/:year/:modelSlug/print` | Refresh-safe print preview with explicit print action |
| unmatched or invalid | Friendly recovery state and route back to selection |

The dimension-query route requires `trim`, `engine`, `engineSize`,
`transmission`, `drivetrain`, `condition`, and `mileage`; optional state includes
`avgMonthlyMileage`, `view`, `task`, and repeated `include` values. The
configuration-key route requires `condition` and `mileage` and verifies that
the key belongs to the requested year/model and condition.

## Data model and identifiers

```text
VehicleModel
  modelId = year:makeSlug:modelSlug
  year, make, model, modelSlug, displayName, configurationCount

VehicleConfiguration
  configId = upstream 40-character Config Key
  configurationGroupId = SHA-1(canonical physical dimensions without condition)
  year, make, model, trim, engine, engineSize, transmission, drivetrain,
  condition, scheduleKey, scheduleHash

MaintenanceSchedule / MaintenanceTask
  remain normalized in SQLite by schedule key/hash and source task key
```

`configId` is condition-specific because it preserves the upstream Config Key.
`configurationGroupId` groups the Normal and Severe records for the same
physical vehicle. Both are deterministic; the validated current artifact has
3,618 unique group IDs with no tuple mismatch. The 2020 4Runner therefore has
one model summary, 12 physical configuration groups, and 24 condition-specific
configuration records.

## API changes

- Added `GET /api/configs/:key` for exact configuration reload; it returns the
  existing configuration row shape or a 404.
- Extended `GET /api/maintenance/grid` with optional `range=full`,
  `minMileage`, and `maxMileage` query parameters.
- Full mode defaults to 0 through the greater of 120,000 miles or the last
  published interval. It uses 5,000-mile navigation ticks plus every authentic
  published interval, but marks cells only where source tasks exist.
- Grid columns expose current/next flags and the payload exposes
  `mileage.next_interval`.
- Bounds are validated in the existing 0–500,000-mile envelope and apply only
  in full mode. Empty schedules remain empty; no tasks are synthesized.
- Existing lookup, options, nearby grid, guide, and schedule response contracts
  remain addressable. Customer-visible filtering is applied server-side.

Compatibility impact of the cumulative diff against `HEAD`:

- `POST /api/maintenance/lookup` now rejects relaxed or ambiguous matches and
  strips hidden tasks plus dealership price/op-code/labor fields. Clients that
  intentionally omitted dimensions or consumed internal mappings must change.
- `GET /api/maintenance/grid` keeps its default nearby window, but its task
  payload is now customer-sanitized and therefore no longer carries mapped
  price/op-code/labor values.
- `POST /api/maintenance/guide` now returns five customer-safe sections instead
  of the former seven-section advisor payload; the internal-advisor section and
  generic benefit prose are no longer public.
- `/api/options`, `/api/configs`, `/api/schedules/*`, and existing route paths
  are unchanged. `GET /api/configs/:key` and `range=full` are additive.

These changes prevent arbitrary configuration selection and internal dealership
data from reaching the customer presentation, but they are not response-level
backward compatible for advisor clients built against the prior shapes.

## Source audit and validator evidence

Authoritative adjacent export:

- `/home/jacen/xtime-toyota-maintenance-export/config_schedules.jsonl`
  - 7,222 JSONL rows
  - 645,250,267 bytes
  - model years 2001–2026
  - 20 condition-specific rows referencing the one authentic empty template
- `/home/jacen/xtime-toyota-maintenance-export/summary.json`
  - source-provided 7,222 total and per-year counts
- `/home/jacen/xtime-toyota-maintenance-export/toyota_maintenance.sqlite`
  - 7,202 `vehicle_configs` rows
  - 2,382,942,208 bytes
- `/home/jacen/xtime-toyota-maintenance-export/unique_schedule_templates.jsonl`
  - 1,764 schedule templates

The 20 source rows absent from the older SQLite database are exactly the 20
empty-template configuration rows (six in 2010 and fourteen in 2026). All 20
share one empty schedule hash. SQLite has no rows not present in the source.

Exact available-source validation (`--mode sample`, exit 0):

```text
7,222 rows
26 years (2001–2026)
542 year/model groups
49 distinct model names
3,618 physical configurations
1,764 schedule hashes
20 condition-specific rows referencing the authentic empty template
0 unmapped configurations
0 integrity errors
21 warnings (20 empty-template configuration rows and missing year 2000)
```

Strict 2000–2026 validation (`--mode full`, exit 1) reports one coverage error:
missing year 2000. It still reports 0 integrity errors and 20 empty-schedule
warnings. The deterministic generated artifact is 4,527,059 bytes with SHA-256
`8d5afabb4e195eaff3da8d3e6b8027cdd8bd92f815863ae751b9250fa646b94d`.

## Completed checklist

- [x] React Router deep links, refresh restoration, and browser history
- [x] Normalized data schema, importer, compact generated catalog, and validator
- [x] One model card per year/model and separate configuration selection
- [x] Exact dimension and configuration-key schedule resolution
- [x] Full horizontally scrollable timeline with sticky header/task column
- [x] Current/next highlights, jump controls, task selection, and detail inspector
- [x] Dedicated print-preview route and explicit browser print action
- [x] Invalid year/model/configuration/mileage/view recovery states
- [x] Customer-safety filtering and no fabricated data/copy
- [x] Responsive and visual QA against the selected concept
- [x] Dependency, test, TypeScript, production-build, diff, and browser checks

## Final verification

All commands use Node 20:

```text
npm ci                                                   exit 0
npm ls --workspaces --depth=0                            exit 0 (lockfile tree consistent)
npm run lint --if-present --workspaces                   exit 0 (no lint script)
npm run typecheck --if-present --workspaces              exit 0 (no standalone script)
npm test                                                 exit 0 (166 tests)
  ETL                                                    55 passed
  server                                                 85 passed
  web                                                    26 passed
npm run build                                            exit 0
  ETL TypeScript                                         passed
  server TypeScript                                      passed
  web TypeScript + Vite production bundle                passed
npm audit --omit=dev --json                              exit 0 (0 production vulnerabilities)
npm audit --json                                         exit 1 (5 dev-tool advisories)
npm run vehicle:validate -- --mode sample --data-dir ... exit 0
npm run vehicle:import -- --mode sample --data-dir ...   exit 0
npm run vehicle:validate -- --mode full --data-dir ...   exit 1 (missing authentic 2000 data)
git diff --check                                         exit 0
```

An unqualified `npm test` under the machine-default Node 24 runtime exited 1
because the installed `better-sqlite3` binary targets Node 20 ABI 115. The
documented Node 20 command was then run after `npm ci` and passed all 166 tests.

Browser verification used the live Fastify API and Vite dev server against a
temporary SQLite database rebuilt from the committed 2020 4Runner fixture.
Direct entry succeeded for `/cockpit`, `/cockpit/2020`,
`/vehicle/2020/4runner`, the complete dimension-query schedule URL, the
configuration-key URL, and print preview. Back, forward, and reload preserved
URL-derived state and route changes focused the main content landmark. The full
grid exposed 0 through 120,000 miles, scrolled horizontally, centered the
70,000-mile current interval, highlighted 75,000 as next, kept mileage headers
sticky through a 500-pixel vertical grid scroll, and kept task/category labels
sticky during horizontal scrolling. Task selection updated both the inspector
and `task` query. No application warning or error occurred during valid flows.
Responsive checks at 1180 × 900 and 760 × 900 had no body-level horizontal
overflow. The final accessibility probe also found the Print link by its full
visible/computed name without an overriding `aria-label`.

## Known gaps

1. The source export contains no authentic year-2000 rows. The importer supports
   2000, but strict coverage intentionally fails until those records are supplied.
2. The adjacent runtime SQLite file still has 7,202 rows. The generated catalog
   audits all 7,222 source rows, but it is not the runtime database; rebuild and
   redeploy SQLite from the current JSONL bundle to make the 20 empty-template
   configurations selectable.
3. The full dependency audit reports five development-tool advisories through
   Vite/Vitest/esbuild. Production dependencies report zero vulnerabilities;
   remediation requires coordinated major-version upgrades and is outside this
   functional refactor.
4. The ETL replacement path is atomic on the supported Linux target. Its Windows
   fallback removes an existing destination before rename, so it cannot provide
   the same crash-safe replacement guarantee there.
5. Exact concept typography and invented marketing copy were not reproduced;
   the implementation favors real schedule facts and working destinations.
