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
is inconsistent: a schedule whose Config Key ≠ `schedule_key`, a missing schedule template hash,
or an engine string it cannot parse. Errors are collected, printed, the partial DB is deleted,
and the process exits 1. On success it records `import_meta` with the build timestamp, ETL
version, and a SHA-256 of every source file — so any DB can be traced back to the exact
artifacts that produced it.

Preserved verbatim per constraint: `schedule_key`, `schedule_hash`, `source`, every source item
field (`service_id`, `service_name`, `description`, `category`, `priority`, `order`, `menu`,
`months`), Airtable record IDs + import timestamps, and the raw schedule JSON
(`schedule_templates.raw_json`) for audit.

Known upstream state: one template is legitimately empty (`sha256("[]")`), referenced by 20
configurations (2010 Corolla Normal rows and 2026 bZ EVs). The ETL loads them and the API/UI
surface them honestly as `schedule_empty` instead of failing or fabricating intervals.

## API (all GET, all read-only)

| Route | Purpose |
| --- | --- |
| `/api/health` | build metadata + row counts |
| `/api/options?year=&model=&…` | distinct values per selector dimension under the current partial filter, plus `matching_schedules` — powers the cascading form |
| `/api/schedules/resolve?…` | filters → matching schedule rows (404 if none; UI requires exactly 1) |
| `/api/schedules/:key` | vehicle + full milestone grid + every item + provenance (feeds the Grid tab) |
| `/api/schedules/:key/due?mileage=&monthly_miles=` | the cockpit payload: snapped due-now milestone + items, next milestone (+ est. months if monthly miles given), 5 nearby milestones, Normal↔Severe delta at this milestone, provenance |

Milestone math (tested): snap to nearest grid point, **ties round up** (72,500 → 75,000);
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

## Tests

```bash
npm test        # 39 tests: etl 13, server 26
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
etl/      schema.sql, lib.ts (parsers, fail-closed), build-db.ts (streaming JSONL → SQLite)
server/   milestones.ts (pure interval math), queries.ts (read-only lookup), app.ts (Fastify)
web/      React cockpit (VehicleForm, MilestoneRail, Grid/List/Guide views, PrintSheet)
fixtures/ 2020 4Runner artifact slice (JSONL) used by the test suite
scripts/  make_fixtures.py — regenerate the fixture slice from full artifacts
```
