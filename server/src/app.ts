/**
 * Fastify app factory. buildApp() so tests can fastify.inject() without a socket.
 * All routes are GET + read-only. No write path exists in this service.
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { Lookup, type VehicleFilters } from "./queries.js";

export interface AppOptions {
  dbPath: string;
  logger?: boolean;
}

const MAX_MILEAGE = 500_000;
const MAX_MONTHLY = 15_000;

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

  void app.register(cors, { origin: true, methods: ["GET"] });

  app.addHook("onClose", async () => lookup.close());

  app.get("/api/health", async () => {
    const meta = lookup.meta();
    return { ok: true, built_at: meta["built_at"] ?? null, etl_version: meta["etl_version"] ?? null, ...lookup.counts() };
  });

  app.get("/api/options", async (req) => {
    return lookup.options(pickFilters(req.query as Record<string, unknown>));
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
