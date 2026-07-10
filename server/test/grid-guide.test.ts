import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const buildScript = join(repoRoot, "etl", "dist", "build-db.js");

let tmp: string;
let app: FastifyInstance;

const BODY = {
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

const GRID_QS =
  "year=2020&model=4RUNNER&trim=SR5&engine=V6&engineSize=4.0L&drivetrain=4WD&transmission=Automatic&drivingCondition=Normal";

beforeAll(async () => {
  expect(existsSync(buildScript), "run `npm run build -w etl` before tests").toBe(true);
  tmp = mkdtempSync(join(tmpdir(), "tmc-grid-guide-"));
  const dbPath = join(tmp, "fixture.db");
  execFileSync("node", [buildScript, "--data-dir", join(repoRoot, "fixtures"), "--out", dbPath], { stdio: "pipe" });

  // Dealership-owned mapping (the ONLY legal home for op codes / labor / price).
  // Inserted before the app opens the DB read-only.
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO service_task_mappings
     (source_task_name, advisor_label, display_category, op_code, labor_hours, menu_price_cents,
      is_customer_visible, advisor_note, created_at, updated_at)
     VALUES ('Rotate tires', 'TIRE ROT', 'Wheels & Tires', '27T', 0.3, 2995, 1, 'fixture mapping', ?, ?)`
  ).run(new Date().toISOString(), new Date().toISOString());
  db.prepare(
    `INSERT INTO vehicle_configs
     (config_key, year, make, model, trim, drivetrain, engine, engine_type, engine_size,
      engine_variant, transmission, driving_condition, schedule_hash, schedule_name,
      source, created_at, updated_at)
     SELECT 'empty-config', 2020, make, 'EMPTYMODEL', 'EMPTY', '4WD', 'V6 4.0L',
            'V6', '4.0L', NULL, 'Automatic', 'Normal', schedule_hash, 'Empty fixture',
            source, ?, ?
     FROM vehicle_configs LIMIT 1`,
  ).run(new Date().toISOString(), new Date().toISOString());
  db.close();

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

describe("GET /api/maintenance/grid", () => {
  it("marks the current interval and windows 2 before / 3 after", async () => {
    const { status, body } = await get(`/api/maintenance/grid?${GRID_QS}&currentMileage=70000`);
    expect(status).toBe(200);
    expect(body.columns.map((c: any) => c.mileage)).toEqual([60000, 65000, 70000, 75000, 80000, 85000]);
    const current = body.columns.filter((c: any) => c.current === true);
    expect(current).toHaveLength(1);
    expect(current[0].mileage).toBe(70000);
    expect(current[0].label).toBe("70,000");
    expect(body.mileage.current_interval).toBe(70000);
  });

  it("has stable row order: two calls agree, oil leads, categories stay contiguous", async () => {
    const a = await get(`/api/maintenance/grid?${GRID_QS}&currentMileage=70000`);
    const b = await get(`/api/maintenance/grid?${GRID_QS}&currentMileage=70000`);
    expect(a.body.rows).toEqual(b.body.rows);

    expect(a.body.rows[0].taskName).toMatch(/engine oil/i);

    const seen = new Set<string>();
    let prev: string | null = null;
    for (const row of a.body.rows) {
      if (row.category !== prev) {
        expect(seen.has(row.category), `category ${row.category} re-appeared`).toBe(false);
        seen.add(row.category);
        prev = row.category;
      }
    }
  });

  it("collapses duplicate task names and keeps drilldown details", async () => {
    const { body } = await get(`/api/maintenance/grid?${GRID_QS}&currentMileage=70000`);
    const names = body.rows.map((r: any) => r.taskName);
    expect(new Set(names).size).toBe(names.length); // one row per display name

    const oil = body.rows.find((r: any) => /engine oil/i.test(r.taskName));
    expect(oil.cells["70000"]).toBe(true);
    expect(oil.cells["65000"]).toBe(false); // 10k oil cadence on this schedule
    expect(oil.cells["75000"]).toBe(false);
    expect(oil.details.length).toBeGreaterThan(0);
    for (const d of oil.details) {
      expect(d).toHaveProperty("task_key");
      expect(d).toHaveProperty("priority");
      expect(d).toHaveProperty("menu");
      expect(d).toHaveProperty("description");
    }
  });

  it("surfaces the dealership advisor_label on mapped rows", async () => {
    const { body } = await get(`/api/maintenance/grid?${GRID_QS}&currentMileage=70000`);
    const rot = body.rows.find((r: any) => r.taskName === "Rotate tires");
    expect(rot.advisor_label).toBe("TIRE ROT");
    expect(rot.category).toBe("Wheels & Tires"); // display_category from the mapping
    expect(rot.details.every((d: any) => d.menu_price_cents === null)).toBe(true);
  });

  it("missing intervals do not crash: below first, near end, above final", async () => {
    const below = await get(`/api/maintenance/grid?${GRID_QS}&currentMileage=3000`);
    expect(below.status).toBe(200);
    expect(below.body.columns.map((c: any) => c.mileage)).toEqual([5000, 10000, 15000]);
    expect(below.body.columns.every((c: any) => c.current !== true)).toBe(true);
    expect(below.body.mileage.current_interval).toBeNull();

    const nearEnd = await get(`/api/maintenance/grid?${GRID_QS}&currentMileage=118000`);
    expect(nearEnd.body.columns.map((c: any) => c.mileage)).toEqual([105000, 110000, 115000, 120000]);
    expect(nearEnd.body.columns.find((c: any) => c.current)?.mileage).toBe(115000);

    const above = await get(`/api/maintenance/grid?${GRID_QS}&currentMileage=125000`);
    expect(above.status).toBe(200);
    expect(above.body.columns.map((c: any) => c.mileage)).toEqual([110000, 115000, 120000]);
    expect(above.body.columns.find((c: any) => c.current)?.mileage).toBe(120000);
  });

  it("returns the additive full 0-120k timeline with current and next markers", async () => {
    const nearby = await get(`/api/maintenance/grid?${GRID_QS}&currentMileage=70000`);
    const { status, body } = await get(
      `/api/maintenance/grid?${GRID_QS}&currentMileage=70000&range=full&minMileage=0&maxMileage=120000`,
    );

    expect(status).toBe(200);
    expect(body.columns[0].mileage).toBe(0);
    expect(body.columns.at(-1).mileage).toBe(120000);
    expect(body.columns.find((column: any) => column.current)?.mileage).toBe(70000);
    expect(body.columns.find((column: any) => column.next)?.mileage).toBe(75000);
    expect(body.mileage).toEqual({ current: 70000, current_interval: 70000, next_interval: 75000 });
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.flatMap((row: any) => row.details).length)
      .toBeGreaterThan(nearby.body.rows.flatMap((row: any) => row.details).length);
    expect(body.rows.flatMap((row: any) => row.details).some((detail: any) => detail.mileage === 5000)).toBe(true);
    expect(body.rows.flatMap((row: any) => row.details).some((detail: any) => detail.mileage === 120000)).toBe(true);
  });

  it("validates full timeline range parameters", async () => {
    const base = `/api/maintenance/grid?${GRID_QS}&currentMileage=70000`;
    expect((await get(`${base}&range=wide`)).status).toBe(400);
    expect((await get(`${base}&range=full&minMileage=-1`)).status).toBe(400);
    expect((await get(`${base}&range=full&maxMileage=500001`)).status).toBe(400);
    expect((await get(`${base}&range=full&minMileage=20000&maxMileage=10000`)).status).toBe(400);
    expect((await get(`${base}&minMileage=0`)).status).toBe(400);
  });

  it("returns the full axis for a schedule with no linked tasks", async () => {
    const query = new URLSearchParams({
      year: "2020",
      model: "EMPTYMODEL",
      trim: "EMPTY",
      engine: "V6",
      engineSize: "4.0L",
      drivetrain: "4WD",
      transmission: "Automatic",
      drivingCondition: "Normal",
      currentMileage: "70000",
      range: "full",
    });
    const { status, body } = await get(`/api/maintenance/grid?${query}`);

    expect(status).toBe(200);
    expect(body.columns[0].mileage).toBe(0);
    expect(body.columns.at(-1).mileage).toBe(120000);
    expect(body.rows).toEqual([]);
    expect(body.mileage.current_interval).toBeNull();
    expect(body.mileage.next_interval).toBeNull();
  });
});

describe("POST /api/maintenance/guide", () => {
  it("includes due_now tasks with Toyota names visible and advisor labels appended", async () => {
    const { status, body } = await post("/api/maintenance/guide", BODY);
    expect(status).toBe(200);
    const ids = body.guide.sections.map((s: any) => s.id);
    expect(ids).toEqual([
      "vehicle_summary", "due_now", "next_visit", "driving_condition_notes", "source_provenance",
    ]);
    const due = body.guide.sections.find((s: any) => s.id === "due_now");
    expect(due.title).toBe("At this interval");
    expect(due.items).toHaveLength(7);
    const labels = due.items.map((i: any) => i.label);
    expect(labels).toContain("Replace engine oil and oil filter");
    expect(labels).toContain("Rotate tires");
    expect(labels).not.toContain("Rotate tires — TIRE ROT");
    expect(due.paragraphs[0]).toContain("At 70,000 miles");
    expect(due.paragraphs[0]).toContain("oil and filter service");
    expect(due.paragraphs[0]).toContain("tire rotation");
  });

  it("includes the next interval with the mileage-based estimate", async () => {
    const { body } = await post("/api/maintenance/guide", BODY);
    const next = body.guide.sections.find((s: any) => s.id === "next_visit");
    const text = next.paragraphs.join(" ");
    expect(text).toContain("75,000");
    expect(text).toMatch(/about 7 months/);
  });

  it("labels severe-condition and recommended items clearly", async () => {
    const severe = await post("/api/maintenance/guide", { ...BODY, drivingCondition: "Severe" });
    const due = severe.body.guide.sections.find((s: any) => s.id === "due_now");
    expect(due.items).toHaveLength(14);
    for (const i of due.items) expect(i.tags).toContain("recommended"); // fixture data has no 'Required' priority
    const severeOnly = due.items.filter((i: any) => i.tags.includes("Severe-condition only"));
    expect(severeOnly).toHaveLength(7); // exactly the items the Normal schedule lacks at 70k
    const notes = severe.body.guide.sections.find((s: any) => s.id === "driving_condition_notes");
    expect(notes.paragraphs.join(" ")).toContain("Severe driving-condition schedule");

    const normal = await post("/api/maintenance/guide", BODY);
    const nNotes = normal.body.guide.sections.find((s: any) => s.id === "driving_condition_notes");
    expect(nNotes.paragraphs.join(" ")).toContain("lists 7 additional items");
    expect(nNotes.paragraphs.join(" ")).not.toMatch(/towing|heavy loads|dusty|short trips/i);
  });

  it("never claims factory-required when the data says recommended", async () => {
    const { body } = await post("/api/maintenance/guide", BODY);
    const text = JSON.stringify(body.guide);
    expect(text).not.toMatch(/factory[- ]required/i);
    expect(text).toContain("recommended by the factory maintenance schedule");
  });

  it("does not return the internal advisor section or dealership mappings", async () => {
    const { body } = await post("/api/maintenance/guide", BODY);
    const text = JSON.stringify(body.guide);
    expect(body.guide.sections.some((s: any) => s.internal)).toBe(false);
    expect(text).not.toContain("internal_advisor_notes");
    expect(text).not.toContain("27T");
    expect(text).not.toContain("0.3 hr");
    expect(text).not.toContain("$29.95");
    expect(text).not.toContain("TIRE ROT");
  });

  it("contains no raw JSON anywhere in the guide", async () => {
    const { body } = await post("/api/maintenance/guide", BODY);
    for (const s of body.guide.sections) {
      for (const p of s.paragraphs) {
        expect(p).not.toMatch(/[{}]/);
        expect(p).not.toContain("schedule_json");
      }
      for (const i of s.items ?? []) expect(i.label).not.toMatch(/[{}]/);
    }
  });

  it("handles a lookup below the first interval without inventing work", async () => {
    const { body } = await post("/api/maintenance/guide", { ...BODY, currentMileage: 3000 });
    const due = body.guide.sections.find((s: any) => s.id === "due_now");
    expect(due.items).toEqual([]);
    expect(due.paragraphs[0]).toContain("first scheduled service is at 5,000 miles");
  });
});
