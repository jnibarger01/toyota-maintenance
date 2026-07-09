import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { intervalContext, overdueTriggered, estimateNext } from "../src/intervals.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const buildScript = join(repoRoot, "etl", "dist", "build-db.js");

const NORMAL_4WD_HASH = "7d807a092e43da66315110c158d3251146bb38af51ae875c4ce0747933a34e21";

let tmp: string;
let app: FastifyInstance;

beforeAll(async () => {
  expect(existsSync(buildScript), "run `npm run build -w etl` before tests").toBe(true);
  tmp = mkdtempSync(join(tmpdir(), "tmc-vehicle-api-"));
  const dbPath = join(tmp, "fixture.db");
  execFileSync("node", [buildScript, "--data-dir", join(repoRoot, "fixtures"), "--out", dbPath], { stdio: "pipe" });
  app = buildApp({ dbPath });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function get(url: string): Promise<{ status: number; body: any }> {
  const res = await app.inject({ method: "GET", url });
  return { status: res.statusCode, body: res.json() };
}

async function post(url: string, payload: unknown): Promise<{ status: number; body: any }> {
  const res = await app.inject({ method: "POST", url, payload: payload as object });
  return { status: res.statusCode, body: res.json() };
}

const LOOKUP = {
  year: 2020,
  model: "4RUNNER",
  trim: "SR5",
  engine: "V6",
  engineSize: "4.0L",
  drivetrain: "4WD",
  transmission: "Automatic",
  drivingCondition: "Normal",
  currentMileage: 70000,
  avgMonthlyMileage: 833,
};

describe("interval math (pure)", () => {
  const grid = [5000, 10000, 15000, 20000];

  it("exact interval", () => {
    expect(intervalContext(10000, grid)).toEqual({ current: 10000, previous: 5000, next: 15000 });
  });
  it("between intervals", () => {
    expect(intervalContext(12000, grid)).toEqual({ current: 10000, previous: 5000, next: 15000 });
  });
  it("below first interval", () => {
    expect(intervalContext(3000, grid)).toEqual({ current: null, previous: null, next: 5000 });
  });
  it("above final interval", () => {
    expect(intervalContext(25000, grid)).toEqual({ current: 20000, previous: 15000, next: null });
  });
  it("empty interval list", () => {
    expect(intervalContext(70000, [])).toEqual({ current: null, previous: null, next: null });
  });
  it("overdue threshold is exclusive", () => {
    expect(overdueTriggered(70000, 65000, 5000)).toBe(false); // exceeds by exactly 5000
    expect(overdueTriggered(70001, 65000, 5000)).toBe(true);
    expect(overdueTriggered(3000, null, 0)).toBe(false);
  });
  it("estimates months to next with ceil, null without pace or next", () => {
    expect(estimateNext(70000, 75000, 833).months_to_next).toBe(7); // 833*6 < 5000
    expect(estimateNext(72000, 75000, 833).months_to_next).toBe(4);
    expect(estimateNext(70000, null, 833)).toEqual({ months_to_next: null, next_due_date: null });
    expect(estimateNext(70000, 75000, null)).toEqual({ months_to_next: null, next_due_date: null });
    expect(estimateNext(70000, 75000, 0)).toEqual({ months_to_next: null, next_due_date: null });
  });
});

describe("GET /api/years, /api/models", () => {
  it("year list returns available years, descending, numeric", async () => {
    const { status, body } = await get("/api/years");
    expect(status).toBe(200);
    expect(body.years).toEqual([2020]);
  });

  it("model list filters by year", async () => {
    const hit = await get("/api/models?year=2020");
    expect(hit.status).toBe(200);
    expect(hit.body.models).toContain("4RUNNER");
    const miss = await get("/api/models?year=1999");
    expect(miss.status).toBe(200);
    expect(miss.body.models).toEqual([]);
  });

  it("model list without a year is a 400, not a 500", async () => {
    const { status } = await get("/api/models");
    expect(status).toBe(400);
  });
});

describe("GET /api/options (selection dimensions)", () => {
  it("returns trims, drivetrains, driving conditions for year+model", async () => {
    const { status, body } = await get("/api/options?year=2020&model=4RUNNER");
    expect(status).toBe(200);
    expect(body.trims).toHaveLength(8);
    expect(body.trims).toContain("SR5");
    expect(body.trims).toContain("TRD Pro");
    expect(body.drivetrains).toEqual(["4WD", "RWD"]);
    expect(body.driving_conditions).toEqual(["Normal", "Severe"]);
    expect(body.engine_sizes).toEqual(["4.0L"]);
  });
});

describe("GET /api/configs", () => {
  it("handles partial filters and includes config_key + schedule_hash", async () => {
    const { status, body } = await get("/api/configs?year=2020&model=4RUNNER");
    expect(status).toBe(200);
    expect(body.count).toBe(24);
    expect(body.truncated).toBe(false);
    for (const c of body.configs) {
      expect(c.config_key).toMatch(/^[0-9a-f]{40}$/);
      expect(c.schedule_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("accepts engine as a type or as the full string", async () => {
    const byType = await get("/api/configs?year=2020&model=4RUNNER&engine=V6");
    const byFull = await get("/api/configs?year=2020&model=4RUNNER&engine=V6%204.0L");
    expect(byType.body.count).toBe(24);
    expect(byFull.body.count).toBe(24);
  });

  it("no results returns empty arrays, not 500", async () => {
    const { status, body } = await get("/api/configs?year=2020&model=4RUNNER&trim=NOPE");
    expect(status).toBe(200);
    expect(body.count).toBe(0);
    expect(body.configs).toEqual([]);
  });
});

describe("POST /api/maintenance/lookup", () => {
  it("2020 4Runner 70,000-mile lookup (exact interval)", async () => {
    const { status, body } = await post("/api/maintenance/lookup", LOOKUP);
    expect(status).toBe(200);
    expect(body.vehicle.driving_condition).toBe("Normal");
    expect(body.resolution.relaxed_fields).toEqual([]);
    expect(body.mileage.current_interval).toBe(70000);
    expect(body.mileage.previous_interval).toBe(65000);
    expect(body.mileage.next_interval).toBe(75000);
    expect(body.due_now).toHaveLength(7);
    expect(body.due_now.map((t: any) => t.task_name)).toContain("Rotate tires");
    expect(body.overdue).toHaveLength(6); // 65k tasks, default 1,000-mile threshold exceeded
    expect(body.overdue.every((t: any) => t.interval_miles === 65000)).toBe(true);
    expect(body.upcoming).toHaveLength(20);
    expect(body.estimate.months_to_next).toBe(7);
    expect(body.estimate.next_due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.source.config_key).toBe("317848a5f55d37ab8609e561e336899bc3bab32b");
    expect(body.source.schedule_hash).toBe(NORMAL_4WD_HASH);
    expect(body.source.source).toBe("Xtime");
    expect(body.source.schedule_name).toContain("4RUNNER");
  });

  it("between intervals floors to the passed interval", async () => {
    const { body } = await post("/api/maintenance/lookup", { ...LOOKUP, currentMileage: 72000 });
    expect(body.mileage.current_interval).toBe(70000);
    expect(body.mileage.next_interval).toBe(75000);
    expect(body.estimate.months_to_next).toBe(4); // ceil(3000/833)
  });

  it("below first interval: nothing due, first interval upcoming", async () => {
    const { body } = await post("/api/maintenance/lookup", { ...LOOKUP, currentMileage: 3000 });
    expect(body.mileage.current_interval).toBeNull();
    expect(body.mileage.previous_interval).toBeNull();
    expect(body.mileage.next_interval).toBe(5000);
    expect(body.due_now).toEqual([]);
    expect(body.overdue).toEqual([]);
    expect(body.upcoming).toHaveLength(7);
    expect(body.upcoming.every((t: any) => t.interval_miles === 5000)).toBe(true);
  });

  it("above final interval: no next, no upcoming, no estimate", async () => {
    const { body } = await post("/api/maintenance/lookup", { ...LOOKUP, currentMileage: 125000 });
    expect(body.mileage.current_interval).toBe(120000);
    expect(body.mileage.next_interval).toBeNull();
    expect(body.upcoming).toEqual([]);
    expect(body.estimate.months_to_next).toBeNull();
    expect(body.estimate.next_due_date).toBeNull();
  });

  it("resolves the best config when the trim is unknown ('Base'), reporting the relaxation", async () => {
    const { status, body } = await post("/api/maintenance/lookup", { ...LOOKUP, trim: "Base" });
    expect(status).toBe(200);
    expect(body.resolution.relaxed_fields).toContain("trim");
    expect(body.resolution.matched_configs).toBeGreaterThan(1);
    expect(body.vehicle.driving_condition).toBe("Normal");
    expect(body.vehicle.drivetrain).toBe("4WD");
    // Every 4WD Normal trim shares one schedule, so the relaxed answer is content-identical.
    expect(body.source.schedule_hash).toBe(NORMAL_4WD_HASH);
    expect(body.due_now).toHaveLength(7);
  });

  it("severe vs normal driving condition produce different config and schedule", async () => {
    const normal = await post("/api/maintenance/lookup", LOOKUP);
    const severe = await post("/api/maintenance/lookup", { ...LOOKUP, drivingCondition: "Severe" });
    expect(severe.status).toBe(200);
    expect(severe.body.source.config_key).not.toBe(normal.body.source.config_key);
    expect(severe.body.source.schedule_hash).not.toBe(normal.body.source.schedule_hash);
    expect(normal.body.due_now).toHaveLength(7);
    expect(severe.body.due_now).toHaveLength(14);
  });

  it("overdue respects a configured threshold", async () => {
    const { body } = await post("/api/maintenance/lookup", { ...LOOKUP, overdueThresholdMiles: 49999 });
    expect(body.mileage.overdue_threshold_miles).toBe(49999);
    expect(body.overdue).toEqual([]); // 70,000 exceeds 65,000 by only 5,000
  });

  it("includes no price without an explicit dealership mapping", async () => {
    const { body } = await post("/api/maintenance/lookup", LOOKUP);
    for (const t of [...body.due_now, ...body.overdue, ...body.upcoming]) {
      expect(t.menu_price_cents).toBeNull();
    }
  });

  it("validates input: 400s and a 404, never a 500", async () => {
    expect((await post("/api/maintenance/lookup", { year: 2020, model: "4RUNNER" })).status).toBe(400);
    expect((await post("/api/maintenance/lookup", { ...LOOKUP, drivingCondition: "Sport" })).status).toBe(400);
    // N1: no silent Normal default — omitting the condition is a 400, not a guess.
    const { drivingCondition: _omit, ...noCondition } = LOOKUP;
    const missing = await post("/api/maintenance/lookup", noCondition);
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain("drivingCondition is required");
    expect((await post("/api/maintenance/lookup", { ...LOOKUP, drivingCondition: "Normal" })).status).toBe(200);
    expect((await post("/api/maintenance/lookup", { ...LOOKUP, drivingCondition: "Severe" })).status).toBe(200);
    expect((await post("/api/maintenance/lookup", { ...LOOKUP, avgMonthlyMileage: 99999 })).status).toBe(400);
    expect((await post("/api/maintenance/lookup", { ...LOOKUP, model: "NOPE" })).status).toBe(404);
  });
});
