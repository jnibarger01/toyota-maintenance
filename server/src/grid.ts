/**
 * GET /api/maintenance/grid builder.
 *
 * The default compatibility window is 2 intervals before current, the current
 * interval, and 3 after (clipped at the ends; with no current interval yet,
 * the first 3 upcoming). The additive full range renders a navigable 5,000
 * mile axis plus every real published interval in the requested bounds.
 *
 * Rows collapse by display name — the task graph keys tasks per
 * (name × interval × menu), so one service appears as ONE row with a boolean
 * cell per column; per-interval task_key/service_id details are preserved for
 * drilldown. Rows are grouped by display category, with category blocks
 * ordered by the classic advisor priority (oil first, then rotation, filters,
 * brakes, fluids, drivetrain, inspections).
 */
import type { TaskIntervalRow } from "./queries.js";
import { intervalContext } from "./intervals.js";

export interface GridColumn {
  mileage: number;
  label: string;
  current?: true;
  next?: true;
}

export interface GridCellDetail {
  mileage: number;
  task_key: string;
  service_id: string | null;
  priority: string | null;
  menu: string | null;
  menu_price_cents: number | null;
  description: string | null;
}

export interface GridRow {
  taskName: string;
  category: string;
  advisor_label: string | null;
  advisor_rank: number;
  description: string | null;
  cells: Record<string, boolean>;
  details: GridCellDetail[];
}

export interface MaintenanceGrid {
  columns: GridColumn[];
  rows: GridRow[];
  currentInterval: number | null;
  nextInterval: number | null;
}

export interface MaintenanceGridOptions {
  range?: "nearby" | "full";
  minMileage?: number;
  maxMileage?: number;
}

const BEFORE = 2;
const AFTER = 3;
const FULL_STEP = 5_000;
const DEFAULT_FULL_MIN = 0;
const DEFAULT_FULL_MAX = 120_000;

/** Classic advisor presentation order; specific name rules first, category fallbacks last. */
export function advisorRank(taskName: string, category: string | null): number {
  const n = taskName.toLowerCase();
  const c = (category ?? "").toLowerCase();
  if (/engine oil|oil.*filter/.test(n)) return 1;
  if (/rotate tires?/.test(n)) return 2;
  if (/cabin air filter/.test(n)) return 3;
  if (/engine air filter/.test(n)) return 4;
  if (/brake/.test(n)) return 5;
  if (/fluid|coolant/.test(n)) return 6;
  if (/driveshaft|drive shaft|differential|transfer case|propeller|axle|transmission/.test(n)) return 7;
  if (/inspect/.test(n)) return 8;
  // Category fallbacks only when no name rule matched.
  if (c === "oil & consumables") return 1;
  if (c === "brakes") return 5;
  if (c === "transmission & axle") return 7;
  if (c === "diagnostics & inspection") return 8;
  return 9;
}

/** Build a blank navigation axis; task cells stay false unless source rows exist. */
function fullAxis(intervals: number[], minMileage: number, maxMileage: number): number[] {
  const axis = new Set<number>([minMileage, maxMileage]);
  const firstTick = Math.ceil(minMileage / FULL_STEP) * FULL_STEP;
  for (let mileage = firstTick; mileage <= maxMileage; mileage += FULL_STEP) axis.add(mileage);
  for (const mileage of intervals) {
    if (mileage >= minMileage && mileage <= maxMileage) axis.add(mileage);
  }
  return [...axis].sort((a, z) => a - z);
}

export function buildMaintenanceGrid(
  tasks: TaskIntervalRow[],
  currentMileage: number,
  options: MaintenanceGridOptions = {},
): MaintenanceGrid {
  const intervals = [...new Set(tasks.map((t) => t.interval_miles))].sort((a, z) => a - z);
  const ctx = intervalContext(currentMileage, intervals);
  const range = options.range ?? "nearby";

  let displayedMileages: number[];
  let displayedTasks: TaskIntervalRow[];
  if (range === "full") {
    const minMileage = options.minMileage ?? DEFAULT_FULL_MIN;
    const publishedMax = intervals.at(-1) ?? DEFAULT_FULL_MIN;
    const maxMileage = options.maxMileage ?? Math.max(DEFAULT_FULL_MAX, publishedMax, minMileage);
    displayedMileages = fullAxis(intervals, minMileage, maxMileage);
    displayedTasks = tasks.filter((task) =>
      task.interval_miles >= minMileage && task.interval_miles <= maxMileage,
    );
  } else if (intervals.length === 0) {
    return { columns: [], rows: [], currentInterval: null, nextInterval: null };
  } else {
    // Floor position; -1 when below the first interval.
    const idx = ctx.current === null ? -1 : intervals.indexOf(ctx.current);
    const start = Math.max(0, idx - BEFORE);
    const end = Math.min(intervals.length - 1, idx + AFTER); // idx = -1 -> first AFTER intervals
    displayedMileages = intervals.slice(start, end + 1);
    const displayedSet = new Set(displayedMileages);
    displayedTasks = tasks.filter((task) => displayedSet.has(task.interval_miles));
  }

  const columns: GridColumn[] = displayedMileages.map((mileage) => {
    const column: GridColumn = { mileage, label: mileage.toLocaleString("en-US") };
    if (mileage === ctx.current) column.current = true;
    if (mileage === ctx.next) column.next = true;
    return column;
  });

  // Collapse by display name across the selected timeline.
  const byName = new Map<string, { rows: TaskIntervalRow[] }>();
  for (const t of displayedTasks) {
    const g = byName.get(t.task_name) ?? { rows: [] };
    g.rows.push(t);
    byName.set(t.task_name, g);
  }

  const rows: GridRow[] = [...byName.entries()].map(([taskName, g]) => {
    const first = g.rows[0];
    const category = first.display_category ?? first.category ?? "Other";
    const present = new Set(g.rows.map((r) => r.interval_miles));
    const cells: Record<string, boolean> = {};
    for (const m of displayedMileages) cells[String(m)] = present.has(m);
    return {
      taskName,
      category,
      advisor_label: first.advisor_label,
      advisor_rank: advisorRank(taskName, category),
      description: first.description,
      cells,
      details: g.rows
        .map((r) => ({
          mileage: r.interval_miles,
          task_key: r.task_key,
          service_id: r.service_id,
          priority: r.priority,
          menu: r.menu,
          menu_price_cents: r.menu_price_cents,
          description: r.description,
        }))
        .sort((a, z) => a.mileage - z.mileage),
    };
  });

  // Category blocks float by their best advisor rank; rows inside a block by rank, then name.
  const categoryRank = new Map<string, number>();
  for (const r of rows) {
    categoryRank.set(r.category, Math.min(categoryRank.get(r.category) ?? 99, r.advisor_rank));
  }
  rows.sort((a, z) =>
    (categoryRank.get(a.category)! - categoryRank.get(z.category)!) ||
    a.category.localeCompare(z.category) ||
    (a.advisor_rank - z.advisor_rank) ||
    a.taskName.localeCompare(z.taskName),
  );

  return {
    columns,
    rows,
    currentInterval: ctx.current,
    nextInterval: ctx.next,
  };
}
