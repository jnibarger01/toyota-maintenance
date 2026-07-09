/**
 * Fastify app factory. buildApp() so tests can fastify.inject() without a socket.
 * All routes are GET + read-only. No write path exists in this service.
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { Lookup, type VehicleFilters, type ConfigFilters } from "./queries.js";
import { intervalContext, overdueTriggered, estimateNext } from "./intervals.js";

export interface AppOptions {
  dbPath: string;
  logger?: boolean;
}

const MAX_MILEAGE = 500_000;
const MAX_MONTHLY = 15_000;
const MAX_OVERDUE_THRESHOLD = 50_000;
const DEFAULT_OVERDUE_THRESHOLD = Number(process.env["TMC_OVERDUE_THRESHOLD_MILES"] ?? 1_000);

function bad(msg: string): never {
  throw Object.assign(new Error(msg), { statusCode: 400 });
}

function parseYear(v: unknown, required: boolean): number | undefined {
  if (v === undefined || v === "") {
    if (required) bad("year is required");
    return undefined;
  }
  const year = Number(v);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) bad("invalid year");
  return year;
}

function optStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/** Canonicalize Normal/Severe (case-insensitive); anything else is a 400. */
function parseCondition(v: unknown): string | undefined {
  const t = optStr(v);
  if (t === undefined) return undefined;
  const c = t.toLowerCase();
  if (c === "normal") return "Normal";
  if (c === "severe") return "Severe";
  bad("drivingCondition must be Normal or Severe");
}

function pickFilters(q: Record<string, unknown>): VehicleFilters {
  const s = (k: string) => (typeof q[k] === "string" && q[k] !== "" ? (q[k] as string) : undefined);
  const year = q["year"] !== undefined && q["year"] !== "" ? Number(q["year"]) : undefined;
  if (year !== undefined && (!Number.isInteger(year) || year < 1990 || year > 2100)) {
    throw Object.assign(new Error("invalid year"), { statusCode: 400 });
  }
  return {
    year,
    model: s("model"),
    trim: s("trim"),
    engine: s("engine"),
    engine_type: s("engine_type"),
    engine_size: s("engine_size"),
    drivetrain: s("drivetrain"),
    transmission: s("transmission"),
    driving_condition: s("driving_condition"),
  };
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  const lookup = new Lookup(opts.dbPath);

  // POST /api/maintenance/lookup is a lookup, not a mutation — the DB stays read-only.
  void app.register(cors, { origin: true, methods: ["GET", "POST"] });

  app.addHook("onClose", async () => lookup.close());

  app.get("/api/health", async () => {
    const meta = lookup.meta();
    return { ok: true, built_at: meta["built_at"] ?? null, etl_version: meta["etl_version"] ?? null, ...lookup.counts() };
  });

  app.get("/api/options", async (req) => {
    return lookup.options(pickFilters(req.query as Record<string, unknown>));
  });

  // ---- Vehicle selection (read-only, SQLite only) --------------------------

  app.get("/api/years", async () => {
    return { years: lookup.years() };
  });

  app.get("/api/models", async (req) => {
    const q = req.query as Record<string, unknown>;
    const year = parseYear(q["year"], true)!;
    return { year, models: lookup.modelsForYear(year) };
  });

  app.get("/api/configs", async (req) => {
    const q = req.query as Record<string, unknown>;
    const f: ConfigFilters = {
      year: parseYear(q["year"], false),
      model: optStr(q["model"]),
      trim: optStr(q["trim"]),
      engine: optStr(q["engine"]),
      engine_size: optStr(q["engine_size"]),
      drivetrain: optStr(q["drivetrain"]),
      transmission: optStr(q["transmission"]),
      driving_condition: parseCondition(q["driving_condition"]),
    };
    const rows = lookup.configsList(f);
    const LIMIT = 500;
    return {
      count: rows.length,
      truncated: rows.length > LIMIT,
      configs: rows.slice(0, LIMIT),
    };
  });

  // ---- Maintenance lookup (floor-interval model over task graph) -----------

  app.post("/api/maintenance/lookup", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;

    const year = parseYear(b["year"], true)!;
    const model = optStr(b["model"]);
    if (!model) bad("model is required");

    const mileage = Number(b["currentMileage"]);
    if (!Number.isInteger(mileage) || mileage < 1 || mileage > MAX_MILEAGE) {
      bad(`currentMileage must be an integer 1..${MAX_MILEAGE}`);
    }

    let avgMonthly: number | null = null;
    if (b["avgMonthlyMileage"] !== undefined && b["avgMonthlyMileage"] !== null && b["avgMonthlyMileage"] !== "") {
      avgMonthly = Number(b["avgMonthlyMileage"]);
      if (!Number.isFinite(avgMonthly) || avgMonthly < 0 || avgMonthly > MAX_MONTHLY) {
        bad(`avgMonthlyMileage must be 0..${MAX_MONTHLY}`);
      }
    }

    let threshold = DEFAULT_OVERDUE_THRESHOLD;
    if (b["overdueThresholdMiles"] !== undefined) {
      threshold = Number(b["overdueThresholdMiles"]);
      if (!Number.isInteger(threshold) || threshold < 0 || threshold > MAX_OVERDUE_THRESHOLD) {
        bad(`overdueThresholdMiles must be an integer 0..${MAX_OVERDUE_THRESHOLD}`);
      }
    }

    const best = lookup.resolveBestConfig({
      year,
      model,
      trim: optStr(b["trim"]),
      engine: optStr(b["engine"]),
      engine_size: optStr(b["engineSize"]),
      drivetrain: optStr(b["drivetrain"]),
      transmission: optStr(b["transmission"]),
      driving_condition: parseCondition(b["drivingCondition"]),
    });
    if (!best) return reply.code(404).send({ error: "no vehicle configuration matches these selections" });

    const tasks = lookup.taskIntervals(best.row.config_key);
    const intervals = [...new Set(tasks.map((t) => t.interval_miles))].sort((a, z) => a - z);
    const ctx = intervalContext(mileage, intervals);
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
        current: mileage,
        current_interval: ctx.current,
        previous_interval: ctx.previous,
        next_interval: ctx.next,
        overdue_threshold_miles: threshold,
      },
      due_now: at(ctx.current),
      overdue: overdueTriggered(mileage, ctx.previous, threshold) ? at(ctx.previous) : [],
      upcoming: at(ctx.next),
      estimate: {
        avg_monthly_mileage: avgMonthly,
        ...estimateNext(mileage, ctx.next, avgMonthly),
      },
    };
  });

  app.get("/api/schedules/resolve", async (req, reply) => {
    const filters = pickFilters(req.query as Record<string, unknown>);
    const rows = lookup.resolve(filters);
    if (rows.length === 0) return reply.code(404).send({ error: "no schedule matches these selections" });
    return { count: rows.length, schedules: rows };
  });

  app.get<{ Params: { key: string } }>("/api/schedules/:key", async (req, reply) => {
    const row = lookup.schedule(req.params.key);
    if (!row) return reply.code(404).send({ error: "schedule not found" });
    const { grid, step } = lookup.grid(row.schedule_hash);
    return {
      vehicle: row,
      grid,
      step,
      items: lookup.allItems(row.schedule_hash),
      provenance: lookup.provenance(row.schedule_key),
    };
  });

  app.get<{ Params: { key: string } }>("/api/schedules/:key/due", async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const mileage = Number(q["mileage"]);
    if (!Number.isInteger(mileage) || mileage < 1 || mileage > MAX_MILEAGE) {
      return reply.code(400).send({ error: `mileage must be an integer 1..${MAX_MILEAGE}` });
    }
    let monthly: number | null = null;
    if (q["monthly_miles"] !== undefined && q["monthly_miles"] !== "") {
      monthly = Number(q["monthly_miles"]);
      if (!Number.isFinite(monthly) || monthly < 0 || monthly > MAX_MONTHLY) {
        return reply.code(400).send({ error: `monthly_miles must be 0..${MAX_MONTHLY}` });
      }
    }
    try {
      return lookup.due(req.params.key, mileage, monthly);
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode === 404) return reply.code(404).send({ error: err.message });
      throw e;
    }
  });

  return app;
}
