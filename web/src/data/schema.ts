/**
 * Frontend vehicle and schedule contracts.
 *
 * API records remain snake_case at the transport boundary. Pages map them to
 * these route-safe concepts instead of carrying ad-hoc component state.
 */

export const MIN_VEHICLE_YEAR = 2000;
export const MAX_VEHICLE_YEAR = 2026;
export const MAX_MILEAGE = 500_000;
export const MAX_MONTHLY_MILEAGE = 15_000;

export type DrivingCondition = "normal" | "severe";
export type ScheduleView = "grid" | "list" | "guide";

export interface ScheduleQueryState {
  condition: DrivingCondition;
  mileage: number;
  avgMonthlyMileage?: number;
  view: ScheduleView;
  task?: string;
}

export interface DimensionScheduleQuery extends ScheduleQueryState {
  trim: string;
  engine: string;
  engineSize: string;
  transmission: string;
  drivetrain: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function modelSlug(model: string): string {
  return model
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function resolveModel(models: string[], slug: string): Parsed<string> {
  const normalized = modelSlug(slug);
  if (!normalized || normalized !== slug.toLowerCase()) {
    return { ok: false, error: "The model address is not valid." };
  }
  const matches = [...new Set(models)].filter((model) => modelSlug(model) === normalized);
  if (matches.length === 0) return { ok: false, error: "That model is not available for this year." };
  if (matches.length > 1) return { ok: false, error: "That model address matches more than one imported model." };
  return { ok: true, value: matches[0] };
}

export function parseVehicleYear(raw: string | undefined): Parsed<number> {
  const year = Number(raw);
  if (!raw || !Number.isInteger(year) || year < MIN_VEHICLE_YEAR || year > MAX_VEHICLE_YEAR) {
    return { ok: false, error: `Model year must be between ${MIN_VEHICLE_YEAR} and ${MAX_VEHICLE_YEAR}.` };
  }
  return { ok: true, value: year };
}

function required(search: URLSearchParams, key: string, label: string): Parsed<string> {
  const value = search.get(key)?.trim();
  return value ? { ok: true, value } : { ok: false, error: `${label} is required in this schedule link.` };
}

function parseNumber(
  search: URLSearchParams,
  key: string,
  label: string,
  min: number,
  max: number,
  optional = false,
): Parsed<number | undefined> {
  const raw = search.get(key);
  if ((raw === null || raw === "") && optional) return { ok: true, value: undefined };
  const value = Number(raw);
  if (raw === null || raw === "" || !Number.isInteger(value) || value < min || value > max) {
    return { ok: false, error: `${label} must be a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.` };
  }
  return { ok: true, value };
}

export function parseScheduleQuery(search: URLSearchParams): Parsed<ScheduleQueryState> {
  const rawCondition = search.get("condition")?.toLowerCase();
  if (rawCondition !== "normal" && rawCondition !== "severe") {
    return { ok: false, error: "Driving condition must be normal or severe." };
  }
  const mileage = parseNumber(search, "mileage", "Mileage", 1, MAX_MILEAGE);
  if (!mileage.ok) return mileage;
  const avgMonthly = parseNumber(search, "avgMonthlyMileage", "Average monthly mileage", 0, MAX_MONTHLY_MILEAGE, true);
  if (!avgMonthly.ok) return avgMonthly;
  const rawView = search.get("view") ?? "grid";
  if (rawView !== "grid" && rawView !== "list" && rawView !== "guide") {
    return { ok: false, error: "Schedule view must be grid, list, or guide." };
  }
  const task = search.get("task")?.trim() || undefined;
  return {
    ok: true,
    value: {
      condition: rawCondition,
      mileage: mileage.value!,
      ...(avgMonthly.value === undefined ? {} : { avgMonthlyMileage: avgMonthly.value }),
      view: rawView,
      ...(task ? { task } : {}),
    },
  };
}

export function parseDimensionScheduleQuery(search: URLSearchParams): Parsed<DimensionScheduleQuery> {
  const base = parseScheduleQuery(search);
  if (!base.ok) return base;
  const dimensions = [
    required(search, "trim", "Trim"),
    required(search, "engine", "Engine"),
    required(search, "engineSize", "Engine size"),
    required(search, "transmission", "Transmission"),
    required(search, "drivetrain", "Drivetrain"),
  ];
  const invalid = dimensions.find((value) => !value.ok);
  if (invalid && !invalid.ok) return invalid;
  return {
    ok: true,
    value: {
      ...base.value,
      trim: dimensions[0].ok ? dimensions[0].value : "",
      engine: dimensions[1].ok ? dimensions[1].value : "",
      engineSize: dimensions[2].ok ? dimensions[2].value : "",
      transmission: dimensions[3].ok ? dimensions[3].value : "",
      drivetrain: dimensions[4].ok ? dimensions[4].value : "",
    },
  };
}

function setCommonSearch(search: URLSearchParams, state: ScheduleQueryState): void {
  search.set("condition", state.condition);
  search.set("mileage", String(state.mileage));
  if (state.avgMonthlyMileage !== undefined) search.set("avgMonthlyMileage", String(state.avgMonthlyMileage));
  search.set("view", state.view);
  if (state.task) search.set("task", state.task);
}

export function configScheduleSearch(state: ScheduleQueryState): string {
  const search = new URLSearchParams();
  setCommonSearch(search, state);
  return search.toString();
}

export function dimensionScheduleSearch(state: DimensionScheduleQuery): string {
  const search = new URLSearchParams();
  search.set("trim", state.trim);
  search.set("engine", state.engine);
  search.set("engineSize", state.engineSize);
  search.set("transmission", state.transmission);
  search.set("drivetrain", state.drivetrain);
  setCommonSearch(search, state);
  return search.toString();
}

export function conditionForApi(condition: DrivingCondition): "Normal" | "Severe" {
  return condition === "normal" ? "Normal" : "Severe";
}
