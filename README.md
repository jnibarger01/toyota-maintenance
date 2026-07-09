# Toyota Maintenance Cockpit

Service-advisor lookup tool: pick a vehicle configuration and an odometer reading, get the
factory maintenance items due now, the next milestone, nearby milestones, an OEM-style interval
grid, an advisor talk-track, and a print-ready customer sheet — with full source provenance on
every result.

```
Xtime scrape artifacts ──► Airtable import artifacts (JSONL)
                                    │
                              etl/build-db.js          (offline, fail-closed)
                                    ▼
                          SQLite lookup DB (tmc.db)
                                    │
                              server (Fastify)          (read-only, GET-only)
                                    ▼
                              web (React/Vite)          (Grid / List / Guide / Print)
```

Airtable is the admin/editing/sync surface only. SQLite is the runtime. The customer flow never
touches the network beyond `127.0.0.1`, never scrapes, never writes, and never sees VIN or
customer data. No pricing appears anywhere (the customer sheet says so and points to the
dealership service menu).

## Quickstart

Requires Node ≥ 20.

```bash
npm install

# 1. Build the lookup DB from your JSONL artifacts (one-time / on re-import)
npm run etl -- --data-dir /path/to/artifacts --out tmc.db
#   expects: airtable_schedules_import.jsonl, unique_schedule_templates.jsonl,
#            airtable_tasks_import.jsonl, airtable_schedule_task_edges.jsonl,
#            airtable_schedule_create_success.jsonl
#   add --skip-edges to omit the 2.1M-row schedule↔task edge table (~smaller DB;
#   edges are audit/anaytics only — the cockpit does not read them)

# 2. Start the read-only API (default 127.0.0.1:8791)
TMC_DB=tmc.db npm run api

# 3. Start the cockpit UI (dev server on :5173, proxies /api to :8791)
npm run dev:web
```

Production-style serving: `npm run build` then `cd web && npx vite preview` (same proxy), or put
`web/dist/` behind any static server that proxies `/api` to the API process.

Environment: `TMC_DB` (db path, default `tmc.db`), `TMC_PORT` (default `8791`), `TMC_HOST`
(default `127.0.0.1`), `TMC_API` (web dev/preview proxy target).

## What the ETL enforces (fail-closed)

`etl/build-db.js` streams the JSONL artifacts and **refuses to produce a database** if anything
is inconsistent: a config whose Config Key ≠ `schedule_key`, a missing schedule template hash,
an engine string it cannot parse, a duplicate vehicle configuration (UNIQUE trap), or an edge
referencing an unknown config/task (foreign keys are enforced during the build). Errors are
collected, printed, the partial DB is deleted, and the process exits 1. On success it records a
single-row `import_meta` (build timestamp, ETL version, source dir, artifact manifest) plus one
`artifact_files` row per source file (SHA-256, line count, byte count) — so any DB traces back
to the exact artifacts that produced it. Non-fatal anomalies (empty templates, provenance
coverage gaps, `--skip-edges`) land in `import_warnings`.

Preserved verbatim per constraint: `config_key` (the upstream `schedule_key`), `schedule_hash`,
`source`, every source item field (`service_id`, `service_name`, `description`, `category`,
`priority`, `order`, `menu`, `months`), the full Airtable `Description` contract text
(`vehicle_configs.raw_description`), Airtable record IDs + timestamps, and the raw schedule JSON
(`schedule_templates.schedule_json`) for audit.

Schema v0.2 tables: `import_meta` (one row per build) · `artifact_files` · `vehicle_configs` ·
`schedule_templates` (+`is_empty`) · `schedule_items` (runtime due engine) · `maintenance_tasks`
· `schedule_task_edges` (FK-enforced) · `service_task_mappings` — the **only** table where op
codes, labor hours, and menu pricing may ever live; dealership-owned, never written by the ETL —
· `import_warnings`, plus views `vehicle_option_years`, `vehicle_option_models`, and
`maintenance_due_view`. No VIN, customer, price, labor, or fee columns exist in any ingestion
table, and a schema test enforces that.

Known upstream state: one template is legitimately empty (`sha256("[]")`), referenced by 20
configurations (2010 Corolla Normal rows and 2026 bZ EVs). The ETL loads them and the API/UI
surface them honestly as `schedule_empty` instead of failing or fabricating intervals.

## API (all GET, all read-only)

| Route | Purpose |
| --- | --- |
| `/api/health` | build metadata + row counts |
| `/api/years` | distinct years, newest first |
| `/api/models?year=` | distinct models for a year |
| `/api/configs?year=&model=&trim=&engine=&engine_size=&drivetrain=&transmission=&driving_condition=` | matching configs (partial filters OK, empty → `[]`, capped at 500 with `truncated` flag); `engine` accepts a type (`V6`) or the full string (`V6 4.0L`); text matches are case-insensitive |
| `POST /api/maintenance/lookup` | task-graph maintenance lookup (see below) — a read-only query despite the verb |
| `GET /api/maintenance/grid?…&currentMileage=` | advisor grid: 2 intervals before current, current (flagged), 3 after; rows collapsed by display name with per-interval drilldown `details`; category blocks ordered oil → rotation → filters → brakes → fluids → drivetrain → inspections; `advisor_label`/`display_category` overlay from `service_task_mappings` when mapped |
| `POST /api/maintenance/guide` | seven-section advisor guide from the same lookup body: vehicle summary, due now, why it matters, next visit, driving-condition notes, source/provenance, and an `internal: true` section (op codes, labor hours, prices, overdue-verify list). Toyota task names stay visible; "required" wording appears only when the task priority says so; Severe-only items are labeled via a live Normal↔Severe delta; no raw JSON in any section |
| `/api/options?year=&model=&…` | distinct values per selector dimension under the current partial filter, plus `matching_schedules` — powers the cascading form |
| `/api/schedules/resolve?…` | filters → matching schedule rows (404 if none; UI requires exactly 1) |
| `/api/schedules/:key` | vehicle + full milestone grid + every item + provenance (feeds the Grid tab) |
| `/api/schedules/:key/due?mileage=&monthly_miles=` | the cockpit payload: snapped due-now milestone + items, next milestone (+ est. months if monthly miles given), 5 nearby milestones, Normal↔Severe delta at this milestone, provenance |

**`POST /api/maintenance/lookup`** takes `{year, model, trim?, engine?, engineSize?, drivetrain?,
transmission?, drivingCondition?, currentMileage, avgMonthlyMileage?, overdueThresholdMiles?}` and
resolves the **best** config: year/model/drivetrain/drivingCondition are hard filters; trim →
engineSize → engine → transmission are relaxed in that order until something matches, and every
relaxation is reported in `resolution.relaxed_fields` (never silent). It then groups the config's
linked `maintenance_tasks` by `interval_miles` — verified to mirror the milestone grid exactly —
and applies a **floor** model: `current_interval` = greatest interval ≤ mileage, `next_interval`
= smallest above, `due_now` = tasks at current, `upcoming` = tasks at next, `overdue` = tasks at
the *previous* interval once mileage exceeds it by `overdueThresholdMiles` (default 1,000; env
`TMC_OVERDUE_THRESHOLD_MILES`). `estimate` projects months/date to the next interval from
`avgMonthlyMileage`. Per-task `menu_price_cents` is `null` unless `service_task_mappings` has an
explicit dealership price. No cycle wrap here (above the final interval, `next` is `null`), and a
`--skip-edges` build returns empty intervals for this endpoint.

Milestone math on `/api/schedules/:key/due` (tested): snap to nearest grid point, **ties round
up** (72,500 → 75,000);
odometer past the published grid wraps the cycle (190,000 on a 120,000 grid ≡ 70,000) and is
flagged `extrapolated`; readings below the first milestone clamp up to it.

Input limits: `mileage` integer 1–500,000; `monthly_miles` 0–15,000. Anything else is a 400.

## UI

Left rail = RO-header-style write-up: Year → Model → Trim → Engine → Engine size → (variant if
needed) → Drivetrain → Transmission → Driving condition, plus odometer and average monthly
miles. Dimensions with exactly one valid value auto-fill (e.g. every 2020 4Runner is V6 4.0L
Automatic). Tabs:

- **Grid** — item × milestone matrix across the five nearby milestones; due column red, next
  column amber.
- **List** — due-now checklist + next-milestone preview.
- **Guide** — advisor walk-through: snap rationale, items grouped by category, Normal↔Severe
  delta at this milestone, next-visit projection with a suggested booking month.
- **Print** — customer sheet preview + `Print customer sheet` (print CSS hides the app and
  prints only the sheet: checkbox list, next visit, provenance footer, no pricing).

Extrapolated readings and empty source schedules are disclosed on-screen and on the printed
sheet. The UI keeps no persistent state (no localStorage, no cookies).

## Airtable admin sync (backend/CLI only)

Airtable is the **admin/editing layer**; SQLite is the **live lookup backend**. The customer
lookup API never calls Airtable, holds no token, and keeps serving from SQLite when Airtable is
down — enforced by tests (`server/test/no-airtable.test.ts`), not convention.

```
cp .env.example .env                       # fill AIRTABLE_TOKEN + AIRTABLE_BASE_ID (never committed)
npm run sync:airtable -- --dry-run         # fetch + validate + report; writes nothing (not even schema)
npm run sync:airtable -- --apply           # transactional upserts by schedule_key + sync-log row
npm run sync:airtable -- --verify          # read-only health checks; needs no Airtable env
```

Behavior: offset pagination until exhausted; schedule_key from an explicit
`schedule_key`/`config_key` field first, else parsed from Description (labeled line, then any
40-hex token); records without a key are warned + skipped, never fatal; duplicate keys update
the existing row (later record wins); Airtable `record_id` is preserved on every row; 429s are
retried with bounded backoff honoring `Retry-After`, transient 5xx retried; the token is
redacted from every error, log line, report, and CLI echo. Optional tables
(`AIRTABLE_MAINTENANCE_TASKS_TABLE`, `AIRTABLE_SERVICE_MAPPING_TABLE`) are mirrored verbatim
into `airtable_tasks_raw` / `airtable_service_mappings_raw` when reachable and skipped with a
warning when not — the schedules sync always completes. Promotion of mirrored pricing rows into
the dealership-owned `service_task_mappings` table is a deliberate, separate step (not automatic).

Tables: `maintenance_schedules` (mirror, unique `schedule_key`) and `airtable_sync_log`
(run_id, mode, status, counts, redacted warnings/errors). Fresh artifact builds include them;
`--apply` also creates them on an existing DB. **Caveat:** an artifact rebuild produces a new
DB file — re-run `sync:airtable --apply` after promoting a rebuilt database.

## Tests

```bash
npm test        # 107 tests: etl 33 (incl. Airtable sync), server 64, web 10
```

Coverage includes the required cases: **2020 4Runner SR5 4WD at ~70,000 mi** (7 Normal items, 14
Severe, exact item names, Normal↔Severe delta) and **interval rounding** (68,500→70k,
72,600→75k, 71,900→70k, 67,400→65k, ties 72,500→75k and 67,500→70k, clamp 1,200→5k, cycle wrap
at grid max, extrapolation 125k→5k and 190k→70k). Server tests build a throwaway DB from the
committed 2020 4Runner artifact slice in `fixtures/` (regenerable from full artifacts via
`scripts/make_fixtures.py`; `npm run etl:fixtures` builds `fixtures/tmc-fixture.db` on disk if
you want one to poke at).

## Layout

```
etl/      schema.sql (v0.2), lib.ts (parsers, fail-closed), build-db.ts (streaming JSONL → SQLite)
server/   milestones.ts + intervals.ts (pure math), maintenance.ts (lookup service), grid.ts, guide.ts, queries.ts, app.ts
web/      React cockpit: Year -> Model -> Details -> Results (Grid | List | Guide tabs) + print sheet
web/      React cockpit (VehicleForm, MilestoneRail, Grid/List/Guide views, PrintSheet)
fixtures/ 2020 4Runner artifact slice (JSONL) used by the test suite
scripts/  make_fixtures.py — regenerate the fixture slice from full artifacts
```
