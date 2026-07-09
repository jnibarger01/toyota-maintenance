import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const buildScript = join(repoRoot, "etl", "dist", "build-db.js");

let tmp: string;
let app: FastifyInstance;

const SR5_4WD_NORMAL = "317848a5f55d37ab8609e561e336899bc3bab32b";
const SR5_4WD_SEVERE = "9c4342b8c5298ec2f4c0520766411eb4ff705401";

beforeAll(async () => {
  expect(existsSync(buildScript), "run `npm run build -w etl` before tests").toBe(true);
  tmp = mkdtempSync(join(tmpdir(), "tmc-api-"));
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

describe("GET /api/options (DoD #2: years/models/options)", () => {
  it("lists available years and models unfiltered", async () => {
    const { status, body } = await get("/api/options");
    expect(status).toBe(200);
    expect(body.years).toContain(2020);
    expect(body.models).toContain("4RUNNER");
    expect(body.matching_schedules).toBe(24);
  });

  it("cascades: 2020 4RUNNER narrows trims/engines/drivetrains", async () => {
    const { body } = await get("/api/options?year=2020&model=4RUNNER");
    expect(body.trims).toContain("SR5");
    expect(body.trims).toContain("TRD Pro");
    expect(body.engines).toEqual([
      { engine: "V6 4.0L", engine_type: "V6", engine_size: "4.0L", engine_variant: null },
    ]);
    expect(body.drivetrains).toEqual(["4WD", "RWD"]);
    expect(body.transmissions).toEqual(["Automatic"]);
    expect(body.driving_conditions).toEqual(["Normal", "Severe"]);
  });

  it("TRD Pro is 4WD-only", async () => {
    const { body } = await get("/api/options?year=2020&model=4RUNNER&trim=TRD%20Pro");
    expect(body.drivetrains).toEqual(["4WD"]);
  });

  it("rejects invalid year", async () => {
    const { status } = await get("/api/options?year=banana");
    expect(status).toBe(400);
  });
});

describe("GET /api/schedules/resolve", () => {
  it("resolves a full selection to exactly one schedule per condition", async () => {
    const q = "year=2020&model=4RUNNER&trim=SR5&engine=V6%204.0L&drivetrain=4WD&transmission=Automatic";
    const { body } = await get(`/api/schedules/resolve?${q}`);
    expect(body.count).toBe(2);
    const byCond = Object.fromEntries(body.schedules.map((s: any) => [s.driving_condition, s.schedule_key]));
    expect(byCond["Normal"]).toBe(SR5_4WD_NORMAL);
    expect(byCond["Severe"]).toBe(SR5_4WD_SEVERE);
  });

  it("404s when nothing matches", async () => {
    const { status } = await get("/api/schedules/resolve?year=2020&model=SUPRA");
    expect(status).toBe(404);
  });
});

describe("GET /api/schedules/:key/due — 2020 4Runner @ 70,000 (DoD #3, #7)", () => {
  it("Normal condition: exactly the 7 Xtime items, next milestone 75k", async () => {
    const { status, body } = await get(`/api/schedules/${SR5_4WD_NORMAL}/due?mileage=70000&monthly_miles=1200`);
    expect(status).toBe(200);
    expect(body.mileage.snapped_milestone).toBe(70_000);
    expect(body.mileage.extrapolated).toBe(false);
    expect(body.due_now.items).toHaveLength(7);
    const names = body.due_now.items.map((i: any) => i.service_name);
    expect(names).toContain("Replace engine oil and oil filter");
    expect(names).toContain("Rotate tires");
    expect(names).toContain("Visually inspect brake linings/drums and brake pads/discs");
    expect(body.next.milestone).toBe(75_000);
    expect(body.next.miles_away).toBe(5_000);
    expect(body.next.est_months_away).toBe(5); // ceil(5000/1200)
    expect(body.nearby.map((n: any) => n.milestone)).toEqual([60_000, 65_000, 70_000, 75_000, 80_000]);
  });

  it("Severe condition at 70k carries 14 items and the comparison names the delta", async () => {
    const { body } = await get(`/api/schedules/${SR5_4WD_SEVERE}/due?mileage=70000`);
    expect(body.due_now.items).toHaveLength(14);
    expect(body.condition_comparison.other_condition).toBe("Normal");
    expect(body.condition_comparison.other_item_count).toBe(7);
  });

  it("interval rounding: 68,500 snaps to 70,000; 67,400 snaps to 65,000", async () => {
    const a = await get(`/api/schedules/${SR5_4WD_NORMAL}/due?mileage=68500`);
    expect(a.body.mileage.snapped_milestone).toBe(70_000);
    expect(a.body.next.milestone).toBe(70_000);
    expect(a.body.next.miles_away).toBe(1_500);
    const b = await get(`/api/schedules/${SR5_4WD_NORMAL}/due?mileage=67400`);
    expect(b.body.mileage.snapped_milestone).toBe(65_000);
  });

  it("beyond-grid odometer extrapolates on the repeating cycle, flagged", async () => {
    const { body } = await get(`/api/schedules/${SR5_4WD_NORMAL}/due?mileage=190000`);
    expect(body.mileage.extrapolated).toBe(true);
    expect(body.mileage.cycle_mileage).toBe(70_000);
    expect(body.mileage.snapped_milestone).toBe(70_000);
    expect(body.due_now.items).toHaveLength(7);
  });

  it("carries provenance: source, keys, Airtable record, build timestamp", async () => {
    const { body } = await get(`/api/schedules/${SR5_4WD_NORMAL}/due?mileage=70000`);
    const p = body.provenance;
    expect(p.source).toBe("Xtime");
    expect(p.schedule_key).toBe(SR5_4WD_NORMAL);
    expect(p.schedule_hash).toHaveLength(64);
    expect(p.airtable_record_id).toMatch(/^rec/);
    expect(p.db_built_at).toMatch(/^\d{4}/);
  });

  it("validates mileage input", async () => {
    expect((await get(`/api/schedules/${SR5_4WD_NORMAL}/due?mileage=0`)).status).toBe(400);
    expect((await get(`/api/schedules/${SR5_4WD_NORMAL}/due?mileage=nope`)).status).toBe(400);
    expect((await get(`/api/schedules/${SR5_4WD_NORMAL}/due?mileage=70000&monthly_miles=-5`)).status).toBe(400);
  });
});
