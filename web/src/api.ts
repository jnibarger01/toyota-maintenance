/**
 * Typed client for the read-only lookup API. Shapes mirror server/src/queries.ts
 * exactly — if the server changes, tsc breaks here, not silently in a component.
 */

export interface ScheduleRow {
  schedule_key: string;
  schedule_hash: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  engine: string;
  engine_type: string;
  engine_size: string;
  engine_variant: string | null;
  drivetrain: string;
  transmission: string;
  driving_condition: string;
  schedule_name: string;
  source: string;
  last_updated: string | null;
}

export interface ItemRow {
  mileage: number;
  months: number | null;
  menu: string;
  service_id: string | null;
  service_name: string;
  description: string | null;
  category: string | null;
  priority: string | null;
  sort_order: number | null;
}

export interface EngineOption {
  engine: string;
  engine_type: string;
  engine_size: string;
  engine_variant: string | null;
}

export interface OptionsResponse {
  years: number[];
  models: string[];
  trims: string[];
  engines: EngineOption[];
  engine_types: string[];
  engine_sizes: string[];
  drivetrains: string[];
  transmissions: string[];
  driving_conditions: string[];
  matching_schedules: number;
}

export interface Provenance {
  source: string;
  schedule_key: string;
  schedule_hash: string;
  last_updated: string | null;
  airtable_record_id: string | null;
  airtable_created_at: string | null;
  db_built_at: string | null;
  etl_version: string | null;
}

export interface NearbyMilestone {
  milestone: number;
  item_count: number;
  relation: "behind" | "due" | "ahead";
}

export interface ConditionComparison {
  other_condition: string;
  other_schedule_key: string;
  other_item_count: number;
  items_only_in_other: string[];
  items_only_in_current: string[];
}

export interface DueResponse {
  vehicle: ScheduleRow;
  schedule_empty: boolean;
  mileage: {
    entered: number;
    cycle_mileage: number | null;
    extrapolated: boolean;
    snapped_milestone: number | null;
    grid_min: number;
    grid_max: number;
    step: number;
  };
  due_now: { milestone: number | null; items: ItemRow[] };
  next: {
    milestone: number | null;
    wraps_cycle: boolean;
    miles_away: number | null;
    est_months_away: number | null;
    items: ItemRow[];
  };
  nearby: NearbyMilestone[];
  grid: number[];
  condition_comparison: ConditionComparison | null;
  provenance: Provenance;
}

export interface ScheduleDetail {
  vehicle: ScheduleRow;
  grid: number[];
  step: number;
  items: ItemRow[];
  provenance: Provenance;
}

export interface ResolveResponse {
  count: number;
  schedules: ScheduleRow[];
}

export interface VehicleFilters {
  year?: number | "";
  model?: string;
  trim?: string;
  engine?: string;
  engine_type?: string;
  engine_size?: string;
  drivetrain?: string;
  transmission?: string;
  driving_condition?: string;
}

function qs(filters: object): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters as Record<string, unknown>)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return (await res.json()) as T;
}

export const api = {
  options: (filters: VehicleFilters) => get<OptionsResponse>(`/api/options${qs(filters)}`),
  resolve: (filters: VehicleFilters) => get<ResolveResponse>(`/api/schedules/resolve${qs(filters)}`),
  schedule: (key: string) => get<ScheduleDetail>(`/api/schedules/${encodeURIComponent(key)}`),
  due: (key: string, mileage: number, monthlyMiles: number | null) =>
    get<DueResponse>(
      `/api/schedules/${encodeURIComponent(key)}/due${qs({ mileage, monthly_miles: monthlyMiles ?? "" })}`
    ),
};

export const fmtMiles = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US");

export const shortHash = (s: string | null | undefined, n = 10): string =>
  s ? `${s.slice(0, n)}…` : "—";
