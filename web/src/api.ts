/**
 * API client for the Toyota Maintenance UI.
 *
 * Every call goes to the local read-only lookup API (vite proxies /api).
 * The browser NEVER talks to Airtable, never scrapes, never sends a VIN,
 * and there are no secrets here — the API is unauthenticated localhost.
 */

export interface LookupTask {
  task_key: string;
  task_name: string;
  description: string | null;
  category: string | null;
  priority: string | null;
  menu: string | null;
  service_id: string | null;
  interval_miles: number;
  menu_price_cents: number | null;
  advisor_label: string | null;
  op_code: string | null;
  labor_hours: number | null;
  display_category: string | null;
  customer_visible: number | null;
}

export interface Vehicle {
  config_key: string;
  schedule_hash: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  engine: string | null;
  engine_type: string | null;
  engine_size: string | null;
  drivetrain: string | null;
  transmission: string | null;
  driving_condition: string;
  schedule_name: string | null;
  source: string;
}

export interface Source {
  config_key: string;
  schedule_hash: string;
  source: string;
  schedule_name: string | null;
}

export interface LookupResult {
  vehicle: Vehicle;
  resolution: { matched_configs: number; relaxed_fields: string[] };
  source: Source;
  intervals: number[];
  mileage: {
    current: number;
    current_interval: number | null;
    previous_interval: number | null;
    next_interval: number | null;
    overdue_threshold_miles: number;
  };
  due_now: LookupTask[];
  overdue: LookupTask[];
  upcoming: LookupTask[];
  estimate: { avg_monthly_mileage: number | null; months_to_next: number | null; next_due_date: string | null };
}

export interface GridColumn { mileage: number; label: string; current?: true; next?: true }
export interface GridCellDetail {
  mileage: number;
  task_key: string;
  service_id: string | null;
  priority: string | null;
  menu: string | null;
  menu_price_cents: number | null;
  description: string | null;
  customer_visible?: number | null;
}
export interface GridRow {
  taskName: string;
  category: string;
  advisor_label: string | null;
  advisor_rank: number;
  cells: Record<string, boolean>;
  details: GridCellDetail[];
  description: string | null;
  customer_visible?: number | null;
}
export interface GridResponse {
  vehicle: Vehicle;
  resolution: { matched_configs: number; relaxed_fields: string[] };
  source: Source;
  mileage: { current: number; current_interval: number | null; next_interval?: number | null };
  columns: GridColumn[];
  rows: GridRow[];
}

export interface GuideItem { label: string; tags: string[] }
export interface GuideSection { id: string; title: string; internal?: true; paragraphs: string[]; items?: GuideItem[] }
export interface GuideResponse { vehicle: Vehicle; source: Source; guide: { sections: GuideSection[] } }

export interface OptionsResponse {
  trims: string[];
  engines: Array<{
    engine: string;
    engine_type: string | null;
    engine_size: string | null;
    engine_variant: string | null;
  }>;
  engine_types: string[];
  engine_sizes: string[];
  drivetrains: string[];
  transmissions: string[];
  driving_conditions: string[];
  matching_schedules?: number;
}

/** Read-only row returned by /api/configs and /api/configs/:key. */
export interface ConfigRecord {
  config_key: string;
  schedule_hash: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  engine: string | null;
  engine_type: string | null;
  engine_size: string | null;
  engine_variant: string | null;
  drivetrain: string | null;
  transmission: string | null;
  driving_condition: string;
  schedule_name: string | null;
  source: string;
}

export interface ConfigsResponse {
  count: number;
  truncated: boolean;
  configs: ConfigRecord[];
}

export interface LookupBody {
  year: number;
  model: string;
  trim?: string;
  engine?: string;
  engineSize?: string;
  drivetrain?: string;
  transmission?: string;
  drivingCondition?: string;
  currentMileage: number;
  avgMonthlyMileage?: number;
}

export interface OptionsFilters {
  year: number;
  model: string;
  trim?: string;
  engine?: string;
  engineSize?: string;
  drivetrain?: string;
  transmission?: string;
  drivingCondition?: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `request failed (${res.status})`, res.status);
  return body as T;
}

export const fetchYears = async (): Promise<number[]> =>
  (await json<{ years: number[] }>(await fetch("/api/years"))).years;

export const fetchModels = async (year: number): Promise<string[]> =>
  (await json<{ models: string[] }>(await fetch(`/api/models?year=${year}`))).models;

export const fetchOptions = async (filters: OptionsFilters): Promise<OptionsResponse> => {
  const q = new URLSearchParams({ year: String(filters.year), model: filters.model });
  if (filters.trim) q.set("trim", filters.trim);
  if (filters.engine) q.set("engine", filters.engine);
  if (filters.engineSize) q.set("engine_size", filters.engineSize);
  if (filters.drivetrain) q.set("drivetrain", filters.drivetrain);
  if (filters.transmission) q.set("transmission", filters.transmission);
  if (filters.drivingCondition) q.set("driving_condition", filters.drivingCondition);
  return json<OptionsResponse>(await fetch(`/api/options?${q.toString()}`));
};

export const fetchConfigs = async (filters: OptionsFilters): Promise<ConfigsResponse> => {
  const q = new URLSearchParams({ year: String(filters.year), model: filters.model });
  if (filters.trim) q.set("trim", filters.trim);
  if (filters.engine) q.set("engine", filters.engine);
  if (filters.engineSize) q.set("engine_size", filters.engineSize);
  if (filters.drivetrain) q.set("drivetrain", filters.drivetrain);
  if (filters.transmission) q.set("transmission", filters.transmission);
  if (filters.drivingCondition) q.set("driving_condition", filters.drivingCondition);
  return json<ConfigsResponse>(await fetch(`/api/configs?${q.toString()}`));
};

/**
 * The detail endpoint is intentionally isolated here because it is the only
 * route-specific transport contract. Accept the documented `{ config }`
 * envelope and a direct record during the additive server rollout.
 */
export const fetchConfig = async (configId: string): Promise<ConfigRecord> => {
  const payload = await json<ConfigRecord | { config: ConfigRecord }>(
    await fetch(`/api/configs/${encodeURIComponent(configId)}`),
  );
  return "config" in payload ? payload.config : payload;
};

export const postLookup = async (body: LookupBody): Promise<LookupResult> =>
  json<LookupResult>(await fetch("/api/maintenance/lookup", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));

export const fetchGrid = async (body: LookupBody, options: { range?: "nearby" | "full" } = {}): Promise<GridResponse> => {
  const q = new URLSearchParams({ year: String(body.year), model: body.model, currentMileage: String(body.currentMileage) });
  for (const k of ["trim", "engine", "engineSize", "drivetrain", "transmission", "drivingCondition"] as const) {
    const v = body[k];
    if (v) q.set(k, v);
  }
  if (options.range) q.set("range", options.range);
  return json<GridResponse>(await fetch(`/api/maintenance/grid?${q.toString()}`));
};

export const postGuide = async (body: LookupBody): Promise<GuideResponse> =>
  json<GuideResponse>(await fetch("/api/maintenance/guide", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
