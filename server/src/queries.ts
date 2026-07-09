/**
 * Read-only query layer. Opens the DB with { readonly: true, fileMustExist: true } —
 * the customer lookup path can never mutate the database.
 */
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { buildContext, monthsToNext, nearbyMilestones, type MilestoneContext } from "./milestones.js";

export interface VehicleFilters {
  year?: number;
  model?: string;
  trim?: string;
  engine?: string;        // full engine string
  engine_type?: string;
  engine_size?: string;
  drivetrain?: string;
  transmission?: string;
  driving_condition?: string;
}

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

/** vehicle_configs -> ScheduleRow projection; config_key is the upstream schedule_key. */
const SCHEDULE_ROW_COLS = `config_key AS schedule_key, schedule_hash, year, make, model, trim,
  engine, engine_type, engine_size, engine_variant, drivetrain, transmission,
  driving_condition, schedule_name, source, last_updated`;

/** Row shape for the vehicle-selection endpoints: config_key exposed by its real name. */
export interface ConfigRow {
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

/** Filters for /api/configs and lookup resolution. `engine` matches engine_type OR the full string. */
export interface ConfigFilters {
  year?: number;
  model?: string;
  trim?: string;
  engine?: string;
  engine_size?: string;
  drivetrain?: string;
  transmission?: string;
  driving_condition?: string;
}

export interface TaskIntervalRow {
  task_key: string;
  task_name: string;
  category: string | null;
  priority: string | null;
  menu: string | null;
  service_id: string | null;
  interval_miles: number;
  /* Dealership-owned mapping fields — null unless service_task_mappings has them. */
  menu_price_cents: number | null;
  advisor_label: string | null;
  op_code: string | null;
  labor_hours: number | null;
  display_category: string | null;
  customer_visible: number | null; // null = unmapped = visible
}

export interface BestConfig {
  row: ConfigRow;
  matched_configs: number;
  relaxed_fields: string[];
}

const CONFIG_ROW_COLS = `config_key, schedule_hash, year, make, model, trim, engine, engine_type,
  engine_size, engine_variant, drivetrain, transmission, driving_condition, schedule_name, source`;

const FILTER_COLS: Array<[keyof VehicleFilters, string]> = [
  ["year", "year"],
  ["model", "model"],
  ["trim", "trim"],
  ["engine", "engine"],
  ["engine_type", "engine_type"],
  ["engine_size", "engine_size"],
  ["drivetrain", "drivetrain"],
  ["transmission", "transmission"],
  ["driving_condition", "driving_condition"],
];

function whereClause(filters: VehicleFilters): { sql: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of FILTER_COLS) {
    const v = filters[key];
    if (v !== undefined && v !== null && v !== "") {
      conds.push(`${col} = ?`);
      params.push(key === "year" ? Number(v) : v);
    }
  }
  return { sql: conds.length ? "WHERE " + conds.join(" AND ") : "", params };
}

export class Lookup {
  readonly db: DB;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
  }

  close(): void { this.db.close(); }

  meta(): Record<string, string> {
    const row = this.db.prepare(
      "SELECT built_at, etl_version, source_dir FROM import_meta WHERE id = 1"
    ).get() as { built_at?: string; etl_version?: string; source_dir?: string } | undefined;
    if (!row) return {};
    const out: Record<string, string> = {};
    if (row.built_at) out["built_at"] = row.built_at;
    if (row.etl_version) out["etl_version"] = row.etl_version;
    if (row.source_dir) out["source_dir"] = row.source_dir;
    return out;
  }

  counts(): { schedules: number; templates: number; items: number } {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      schedules: one("SELECT COUNT(*) n FROM vehicle_configs"),
      templates: one("SELECT COUNT(*) n FROM schedule_templates"),
      items: one("SELECT COUNT(*) n FROM schedule_items"),
    };
  }

  /** Distinct values for every selector dimension under the current partial filter, plus match count. */
  options(filters: VehicleFilters): Record<string, unknown> {
    const { sql, params } = whereClause(filters);
    const distinct = (col: string, orderBy = col) =>
      this.db.prepare(`SELECT DISTINCT ${col} AS v FROM vehicle_configs ${sql} ORDER BY ${orderBy}`)
        .all(...params).map((r) => (r as { v: unknown }).v);
    const engines = this.db.prepare(
      `SELECT DISTINCT engine, engine_type, engine_size, engine_variant
       FROM vehicle_configs ${sql} ORDER BY engine_type, engine_size`
    ).all(...params);
    const match = this.db.prepare(`SELECT COUNT(*) n FROM vehicle_configs ${sql}`).get(...params) as { n: number };
    return {
      years: distinct("year", "year DESC"),
      models: distinct("model"),
      trims: distinct("trim"),
      engines,
      engine_types: distinct("engine_type"),
      engine_sizes: distinct("engine_size"),
      drivetrains: distinct("drivetrain"),
      transmissions: distinct("transmission"),
      driving_conditions: distinct("driving_condition"),
      matching_schedules: match.n,
    };
  }

  /** Resolve filters to schedule rows. Exactly-one is the caller's contract for /due. */
  resolve(filters: VehicleFilters): ScheduleRow[] {
    const { sql, params } = whereClause(filters);
    return this.db.prepare(`SELECT ${SCHEDULE_ROW_COLS} FROM vehicle_configs ${sql} ORDER BY driving_condition`).all(...params) as ScheduleRow[];
  }

  schedule(scheduleKey: string): ScheduleRow | undefined {
    return this.db.prepare(`SELECT ${SCHEDULE_ROW_COLS} FROM vehicle_configs WHERE config_key = ?`).get(scheduleKey) as ScheduleRow | undefined;
  }

  /** Sibling schedule: same config, other driving condition. */
  sibling(row: ScheduleRow): ScheduleRow | undefined {
    return this.db.prepare(
      `SELECT ${SCHEDULE_ROW_COLS} FROM vehicle_configs
       WHERE year=? AND model=? AND trim=? AND engine=? AND drivetrain=? AND transmission=?
         AND driving_condition <> ?`
    ).get(row.year, row.model, row.trim, row.engine, row.drivetrain, row.transmission, row.driving_condition) as ScheduleRow | undefined;
  }

  provenance(scheduleKey: string): Record<string, unknown> {
    const row = this.schedule(scheduleKey);
    if (!row) return {};
    const at = this.db.prepare("SELECT airtable_record_id, airtable_created_at FROM vehicle_configs WHERE config_key = ?")
      .get(scheduleKey) as { airtable_record_id?: string; airtable_created_at?: string } | undefined;
    const meta = this.meta();
    return {
      source: row.source,
      schedule_key: row.schedule_key,
      schedule_hash: row.schedule_hash,
      last_updated: row.last_updated,
      airtable_record_id: at?.airtable_record_id ?? null,
      airtable_created_at: at?.airtable_created_at ?? null,
      db_built_at: meta["built_at"] ?? null,
      etl_version: meta["etl_version"] ?? null,
    };
  }

  grid(scheduleHash: string): { grid: number[]; step: number } {
    const tpl = this.db.prepare("SELECT grid_step FROM schedule_templates WHERE schedule_hash = ?")
      .get(scheduleHash) as { grid_step: number } | undefined;
    if (!tpl) throw new Error(`template not found: ${scheduleHash}`);
    const grid = (this.db.prepare(
      "SELECT DISTINCT mileage FROM schedule_items WHERE schedule_hash = ? ORDER BY mileage"
    ).all(scheduleHash) as Array<{ mileage: number }>).map((r) => r.mileage);
    return { grid, step: tpl.grid_step };
  }

  itemsAt(scheduleHash: string, mileage: number): ItemRow[] {
    return this.db.prepare(
      `SELECT mileage, months, menu, service_id, service_name, description, category, priority, sort_order
       FROM schedule_items WHERE schedule_hash = ? AND mileage = ?
       ORDER BY sort_order, service_name`
    ).all(scheduleHash, mileage) as ItemRow[];
  }

  allItems(scheduleHash: string): ItemRow[] {
    return this.db.prepare(
      `SELECT mileage, months, menu, service_id, service_name, description, category, priority, sort_order
       FROM schedule_items WHERE schedule_hash = ?
       ORDER BY mileage, sort_order, service_name`
    ).all(scheduleHash) as ItemRow[];
  }

  /** The complete /due payload for a schedule at an odometer reading. */
  due(scheduleKey: string, mileage: number, monthlyMiles?: number | null): Record<string, unknown> {
    const row = this.schedule(scheduleKey);
    if (!row) throw Object.assign(new Error("schedule not found"), { statusCode: 404 });
    const { grid, step } = this.grid(row.schedule_hash);

    // Legitimate upstream state: source schedule carries zero items (EV configs, extraction gaps).
    // Surface it honestly rather than 500ing or fabricating intervals.
    if (grid.length === 0) {
      return {
        vehicle: row,
        schedule_empty: true,
        mileage: { entered: mileage, cycle_mileage: null, extrapolated: false, snapped_milestone: null, grid_min: 0, grid_max: 0, step: 0 },
        due_now: { milestone: null, items: [] },
        next: { milestone: null, wraps_cycle: false, miles_away: null, est_months_away: null, items: [] },
        nearby: [],
        grid,
        condition_comparison: null,
        provenance: this.provenance(scheduleKey),
      };
    }
    const ctx: MilestoneContext = buildContext(mileage, grid, step);

    const dueItems = this.itemsAt(row.schedule_hash, ctx.snapped);
    const nextItems = this.itemsAt(row.schedule_hash, ctx.next);
    const nearby = nearbyMilestones(ctx.snapped, grid, 2, 2).map((m) => ({
      milestone: m,
      item_count: this.itemsAt(row.schedule_hash, m).length,
      relation: m < ctx.snapped ? "behind" : m === ctx.snapped ? "due" : "ahead",
    }));

    // Fixed-ops touch: how does the OTHER driving condition compare at this milestone?
    const sib = this.sibling(row);
    let conditionComparison: Record<string, unknown> | null = null;
    if (sib) {
      const sibGrid = this.grid(sib.schedule_hash);
      if (sibGrid.grid.length > 0) {
        const sibSnap = buildContext(mileage, sibGrid.grid, sibGrid.step).snapped;
        const sibItems = this.itemsAt(sib.schedule_hash, sibSnap);
        const mine = new Set(dueItems.map((i) => i.service_name));
        const theirs = new Set(sibItems.map((i) => i.service_name));
        conditionComparison = {
          other_condition: sib.driving_condition,
          other_schedule_key: sib.schedule_key,
          other_item_count: sibItems.length,
          items_only_in_other: [...theirs].filter((s) => !mine.has(s)),
          items_only_in_current: [...mine].filter((s) => !theirs.has(s)),
        };
      }
    }

    return {
      vehicle: row,
      schedule_empty: false,
      mileage: {
        entered: ctx.entered,
        cycle_mileage: ctx.cycleMileage,
        extrapolated: ctx.extrapolated,
        snapped_milestone: ctx.snapped,
        grid_min: ctx.gridMin,
        grid_max: ctx.gridMax,
        step: ctx.step,
      },
      due_now: { milestone: ctx.snapped, items: dueItems },
      next: {
        milestone: ctx.next,
        wraps_cycle: ctx.nextWraps,
        miles_away: ctx.milesToNext,
        est_months_away: monthsToNext(ctx.milesToNext, monthlyMiles),
        items: nextItems,
      },
      nearby,
      grid,
      condition_comparison: conditionComparison,
      provenance: this.provenance(scheduleKey),
    };
  }

  // ------------------------------------------------------------------------
  // Vehicle-selection endpoints (read-only, SQLite only — never Airtable).
  // ------------------------------------------------------------------------

  /** Distinct years, newest first. Blank/NULL filtered. */
  years(): number[] {
    return (this.db.prepare(
      "SELECT DISTINCT year FROM vehicle_configs WHERE year IS NOT NULL ORDER BY year DESC"
    ).all() as Array<{ year: number }>).map((r) => r.year);
  }

  /** Distinct models for a year, alphabetical. */
  modelsForYear(year: number): string[] {
    return (this.db.prepare(
      `SELECT DISTINCT model FROM vehicle_configs
       WHERE year = ? AND model IS NOT NULL AND TRIM(model) <> ''
       ORDER BY model`
    ).all(year) as Array<{ model: string }>).map((r) => r.model);
  }

  private configWhere(f: ConfigFilters): { sql: string; params: unknown[] } {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (f.year !== undefined) { conds.push("year = ?"); params.push(f.year); }
    for (const col of ["model", "trim", "engine_size", "drivetrain", "transmission"] as const) {
      const v = f[col];
      if (v !== undefined && v !== "") { conds.push(`${col} = ? COLLATE NOCASE`); params.push(v); }
    }
    if (f.engine !== undefined && f.engine !== "") {
      // Accept an engine type ("V6") or the full engine string ("V6 4.0L").
      conds.push("(engine_type = ? COLLATE NOCASE OR engine = ? COLLATE NOCASE)");
      params.push(f.engine, f.engine);
    }
    if (f.driving_condition !== undefined && f.driving_condition !== "") {
      conds.push("driving_condition = ?"); params.push(f.driving_condition);
    }
    return { sql: conds.length ? "WHERE " + conds.join(" AND ") : "", params };
  }

  /** Matching configs for partial filters. Empty match -> empty array, never a throw. */
  configsList(f: ConfigFilters): ConfigRow[] {
    const { sql, params } = this.configWhere(f);
    return this.db.prepare(
      `SELECT ${CONFIG_ROW_COLS} FROM vehicle_configs ${sql}
       ORDER BY year DESC, model, trim, driving_condition, config_key`
    ).all(...params) as ConfigRow[];
  }

  /**
   * Resolve the best config for a lookup request.
   * Hard filters (never relaxed): year, model, drivetrain, driving_condition.
   * Soft filters relaxed in order until something matches: trim, engine_size, engine, transmission.
   * Deterministic pick: Normal before Severe, then trim, then config_key.
   */
  resolveBestConfig(f: ConfigFilters): BestConfig | null {
    const softOrder: Array<keyof ConfigFilters> = ["trim", "engine_size", "engine", "transmission"];
    const relaxed: string[] = [];
    const attempt: ConfigFilters = { ...f };
    for (let step = 0; step <= softOrder.length; step++) {
      const rows = this.configsList(attempt);
      if (rows.length > 0) {
        rows.sort((a, b) =>
          a.driving_condition.localeCompare(b.driving_condition) ||
          (a.trim ?? "").localeCompare(b.trim ?? "") ||
          a.config_key.localeCompare(b.config_key));
        return { row: rows[0], matched_configs: rows.length, relaxed_fields: relaxed };
      }
      if (step === softOrder.length) break;
      const field = softOrder[step];
      if (attempt[field] !== undefined) {
        delete attempt[field];
        relaxed.push(field);
      }
    }
    return null;
  }

  /**
   * Linked maintenance tasks for a config via schedule_task_edges, with each
   * task's interval_miles. Price appears ONLY when service_task_mappings has
   * an explicit menu_price_cents for the task name (dealership-owned data).
   */
  taskIntervals(configKey: string): TaskIntervalRow[] {
    // Scalar subqueries (first mapping row wins, by id) so mapping rows can
    // never multiply task rows. All mapping fields are dealership-owned.
    const map = (col: string, extra = "") =>
      `(SELECT m.${col} FROM service_task_mappings m
         WHERE m.source_task_name = mt.task_name ${extra} ORDER BY m.id LIMIT 1)`;
    return this.db.prepare(
      `SELECT mt.task_key, mt.task_name, mt.category, mt.priority, mt.menu, mt.service_id, mt.interval_miles,
              ${map("menu_price_cents", "AND m.menu_price_cents IS NOT NULL")} AS menu_price_cents,
              ${map("advisor_label", "AND m.advisor_label IS NOT NULL")}       AS advisor_label,
              ${map("op_code", "AND m.op_code IS NOT NULL")}                   AS op_code,
              ${map("labor_hours", "AND m.labor_hours IS NOT NULL")}           AS labor_hours,
              ${map("display_category", "AND m.display_category IS NOT NULL")} AS display_category,
              ${map("is_customer_visible")}                                    AS customer_visible
       FROM schedule_task_edges e
       JOIN maintenance_tasks mt USING (task_key)
       WHERE e.config_key = ? AND mt.interval_miles IS NOT NULL
         -- B1 dedupe (display layer only): the source data sometimes carries the
         -- same line under two service_ids; both task rows stay in the DB, but
         -- customer-visible output keeps exactly one row per (task_name,
         -- interval_miles) — the MIN(task_key) as the stable representative.
         AND mt.task_key = (
           SELECT MIN(mt2.task_key)
           FROM schedule_task_edges e2
           JOIN maintenance_tasks mt2 USING (task_key)
           WHERE e2.config_key = e.config_key
             AND mt2.task_name = mt.task_name
             AND mt2.interval_miles = mt.interval_miles
         )
       ORDER BY mt.interval_miles, mt.task_name`
    ).all(configKey) as TaskIntervalRow[];
  }
}
