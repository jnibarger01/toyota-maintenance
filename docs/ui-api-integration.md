# Customer Cockpit UI and API Integration

The cockpit is a read-only customer presentation of imported Toyota factory
maintenance schedules. It does not write to Xtime, Airtable, or SQLite and it
does not send VIN, customer, credential, price, labor, or operation-code data to
the browser.

## Browser routes

| Route | Responsibility |
| --- | --- |
| `/cockpit` | Select an imported model year |
| `/cockpit/:year` | Select one distinct model for that year |
| `/vehicle/:year/:modelSlug` | Select a valid physical configuration and condition |
| `/schedule/:year/:modelSlug?...` | Reload an exact dimension-query schedule |
| `/schedule/:year/:modelSlug/:configId?...` | Reload an exact upstream configuration key |
| `/schedule/:year/:modelSlug/print?...` | Preview the selected factual tasks and invoke printing |

React Router owns the state boundary. Back/forward, direct entry, and refresh
all reconstruct the selection from route and query values; no hidden component
state is required to identify the vehicle or schedule.

The dimension-query schedule route requires:

```text
trim, engine, engineSize, transmission, drivetrain, condition, mileage
```

The configuration-key route requires `condition` and `mileage`. Optional state
is `avgMonthlyMileage`, `view`, `task`, and repeated `include` values. Invalid
years, slugs, keys, dimensions, conditions, and mileage values render recovery
states rather than silently changing the vehicle.

## API wiring

The Vite client calls same-origin `/api`, proxied to the local Fastify service
during development.

| UI behavior | API request | Contract |
| --- | --- | --- |
| Load years | `GET /api/years` | Distinct imported years |
| Load model cards | `GET /api/models?year={year}` | Distinct model labels; configurations are not duplicated as cards |
| Cascade selectors | `GET /api/options?year={year}&model={model}&...` | Valid remaining dimensions under the current exact filters |
| Resolve a dimension route | `GET /api/configs?...` | Must return exactly one configuration and not be truncated |
| Reload a key route | `GET /api/configs/:key` | Exact condition-specific upstream Config Key or 404 |
| Load summary/list state | `POST /api/maintenance/lookup` | Read-only exact lookup despite the HTTP verb |
| Load full grid | `GET /api/maintenance/grid?...&range=full` | Customer-safe 0–120,000+ timeline and authentic task cells |
| Load guide | `POST /api/maintenance/guide` | Customer-safe factual sections from the same lookup body |

The shared lookup body is:

```ts
{
  year,
  model,
  trim,
  engine,
  engineSize,
  transmission,
  drivetrain,
  drivingCondition,
  currentMileage,
  avgMonthlyMileage?
}
```

Every available physical dimension is required by the customer UI. A response
that relaxes a field or matches multiple configurations is rejected by the
route loader.

## Full-grid compatibility contract

`GET /api/maintenance/grid` keeps its existing nearby-window response when no
`range` is supplied. `range=full` is additive and accepts optional
`minMileage`/`maxMileage` bounds from 0 through 500,000 miles.

Full mode:

- defaults to 0 through at least 120,000 miles;
- includes 5,000-mile navigation ticks and every real published interval;
- marks a cell only when an imported task exists at that interval;
- exposes current and next column flags plus `mileage.next_interval`;
- preserves the server-side customer-visible filter;
- returns a blank navigation axis and no synthetic task rows for an empty schedule.

The cumulative customer-presentation hardening is deliberately not payload-
compatible with older internal/advisor consumers: public lookup now rejects
relaxed or ambiguous configurations, customer lookup/grid responses strip
mapped price/op-code/labor fields, and the guide returns five customer-safe
sections instead of the former seven-section advisor response. Endpoint paths
remain stable; the exact-key route and full-grid mode are additive.

## Identifier strategy

- `configId` / `scheduleKey`: the upstream 40-character Config Key, preserving
  one condition-specific source record exactly.
- `configurationGroupId`: SHA-1 of canonical year, make, model, trim, full
  engine/variant, transmission, and drivetrain values, excluding condition.
- `modelId`: `year:makeSlug:modelSlug`.

Normal and Severe records for the same physical vehicle therefore share one
`configurationGroupId` but retain separate `configId` values.

## Customer-safety boundary

- The server maintenance layer removes `customer_visible = 0` rows before serialization.
- Customer grid, list, guide, inspector, and print components receive no price,
  operation-code, labor-hour, VIN, customer, or credential data.
- Empty schedules stay empty and are disclosed; missing facts are not invented.
- The inspector shows source task name/category, published mileages, priority,
  condition, and provenance only when present in imported data.
- Unsupported concept navigation and unverified benefit/procedure copy are not
  rendered as working customer facts.

## Verification

Use Node 20 on this machine because `better-sqlite3` is built for that runtime:

```bash
PATH=/home/jacen/.nvm/versions/node/v20.19.0/bin:$PATH npm test
PATH=/home/jacen/.nvm/versions/node/v20.19.0/bin:$PATH npm run build
PATH=/home/jacen/.nvm/versions/node/v20.19.0/bin:$PATH npm run vehicle:validate -- --mode sample --data-dir /home/jacen/xtime-toyota-maintenance-export
PATH=/home/jacen/.nvm/versions/node/v20.19.0/bin:$PATH TMC_DB=/path/to/tmc.db TMC_PORT=8791 npm run dev:api
PATH=/home/jacen/.nvm/versions/node/v20.19.0/bin:$PATH npm run dev:web
```
