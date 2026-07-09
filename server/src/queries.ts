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
}
