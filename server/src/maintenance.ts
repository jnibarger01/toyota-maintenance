/**
 * Maintenance lookup service — the single implementation behind
 * POST /api/maintenance/lookup, GET /api/maintenance/grid, and
 * POST /api/maintenance/guide. Read-only; SQLite only; never Airtable.
 */
import type { Lookup, ConfigRow, TaskIntervalRow, BestConfig } from "./queries.js";
import { intervalContext, overdueTriggered, estimateNext } from "./intervals.js";

export interface MaintenanceLookupInput {
  year: number;
  model: string;
  trim?: string;
  engine?: string;
  engineSize?: string;
  drivetrain?: string;
  transmission?: string;
  drivingCondition?: string; // canonical "Normal" | "Severe"
  currentMileage: number;
  avgMonthlyMileage?: number | null;
  overdueThresholdMiles: number;
}

export interface LookupResult {
  vehicle: ConfigRow;
  resolution: { matched_configs: number; relaxed_fields: string[] };
  source: { config_key: string; schedule_hash: string; source: string; schedule_name: string | null };
  intervals: number[];
  mileage: {
    current: number;
    current_interval: number | null;
    previous_interval: number | null;
    next_interval: number | null;
    overdue_threshold_miles: number;
  };
  due_now: TaskIntervalRow[];
  overdue: TaskIntervalRow[];
  upcoming: TaskIntervalRow[];
  estimate: { avg_monthly_mileage: number | null; months_to_next: number | null; next_due_date: string | null };
}

export function resolveConfig(lookup: Lookup, input: MaintenanceLookupInput): BestConfig | null {
  return lookup.resolveBestConfig({
    year: input.year,
    model: input.model,
    trim: input.trim,
    engine: input.engine,
    engine_size: input.engineSize,
    drivetrain: input.drivetrain,
    transmission: input.transmission,
    driving_condition: input.drivingCondition,
  });
}

export function runMaintenanceLookup(lookup: Lookup, input: MaintenanceLookupInput): LookupResult | null {
  const best = resolveConfig(lookup, input);
  if (!best) return null;

  const tasks = lookup.taskIntervals(best.row.config_key);
  const intervals = [...new Set(tasks.map((t) => t.interval_miles))].sort((a, z) => a - z);
  const ctx = intervalContext(input.currentMileage, intervals);
  const at = (m: number | null) => (m === null ? [] : tasks.filter((t) => t.interval_miles === m));

  return {
    vehicle: best.row,
    resolution: { matched_configs: best.matched_configs, relaxed_fields: best.relaxed_fields },
    source: {
      config_key: best.row.config_key,
      schedule_hash: best.row.schedule_hash,
      source: best.row.source,
      schedule_name: best.row.schedule_name,
    },
    intervals,
    mileage: {
      current: input.currentMileage,
      current_interval: ctx.current,
      previous_interval: ctx.previous,
      next_interval: ctx.next,
      overdue_threshold_miles: input.overdueThresholdMiles,
    },
    due_now: at(ctx.current),
    overdue: overdueTriggered(input.currentMileage, ctx.previous, input.overdueThresholdMiles) ? at(ctx.previous) : [],
    upcoming: at(ctx.next),
    estimate: {
      avg_monthly_mileage: input.avgMonthlyMileage ?? null,
      ...estimateNext(input.currentMileage, ctx.next, input.avgMonthlyMileage),
    },
  };
}

/**
 * Delta vs the opposite driving condition at the same current interval —
 * feeds honest "Severe adds N items" guide language. Null when no sibling.
 */
export interface ConditionDelta {
  other_condition: string;
  other_count: number;
  only_in_current: string[];
  added_in_other: string[];
}

export function conditionDelta(lookup: Lookup, input: MaintenanceLookupInput, result: LookupResult): ConditionDelta | null {
  if (result.mileage.current_interval === null) return null;
  const other = result.vehicle.driving_condition === "Normal" ? "Severe" : "Normal";
  const sibling = lookup.resolveBestConfig({
    year: result.vehicle.year,
    model: result.vehicle.model,
    trim: result.vehicle.trim ?? undefined,
    engine: result.vehicle.engine ?? undefined,
    drivetrain: result.vehicle.drivetrain ?? undefined,
    transmission: result.vehicle.transmission ?? undefined,
    driving_condition: other,
  });
  if (!sibling) return null;
  const sibTasks = lookup.taskIntervals(sibling.row.config_key);
  const sibIntervals = [...new Set(sibTasks.map((t) => t.interval_miles))].sort((a, z) => a - z);
  const sibCtx = intervalContext(input.currentMileage, sibIntervals);
  const sibNames = new Set(
    sibTasks.filter((t) => sibCtx.current !== null && t.interval_miles === sibCtx.current).map((t) => t.task_name),
  );
  const mine = new Set(result.due_now.map((t) => t.task_name));
  return {
    other_condition: other,
    other_count: sibNames.size,
    only_in_current: [...mine].filter((n) => !sibNames.has(n)),
    added_in_other: [...sibNames].filter((n) => !mine.has(n)),
  };
}
