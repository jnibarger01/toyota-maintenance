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
};

beforeAll(async () => {
  expect(existsSync(buildScript), "run `npm run build -w etl` before tests").toBe(true);
  tmp = mkdtempSync(join(tmpdir(), "tmc-customer-surface-"));
  const dbPath = join(tmp, "fixture.db");
  execFileSync("node", [buildScript, "--data-dir", join(repoRoot, "fixtures"), "--out", dbPath], { stdio: "pipe" });

  const db = new Database(dbPath);
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO service_task_mappings
     (source_task_name, advisor_label, display_category, op_code, labor_hours, menu_price_cents,
      is_customer_visible, advisor_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run("Replace engine oil and oil filter", "OIL SERVICE", "Oil & Consumables", "LOF", 0.5, 4995, 1, "internal", now, now);
  insert.run("Rotate tires", "HIDDEN ROTATION", "Wheels & Tires", "ROT", 0.3, 2995, 0, "internal", now, now);
  db.close();

  app = buildApp({ dbPath });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("customer lookup payload", () => {
  it("omits mapped prices/internal fields and hidden customer items", async () => {
    const res = await app.inject({ method: "POST", url: "/api/maintenance/lookup", payload: LOOKUP });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const text = JSON.stringify(body);

    expect(body.due_now.map((t: { task_name: string }) => t.task_name)).toContain("Replace engine oil and oil filter");
    expect(body.due_now.map((t: { task_name: string }) => t.task_name)).not.toContain("Rotate tires");
    expect(text).not.toContain("4995");
    expect(text).not.toContain("2995");
    expect(text).not.toContain("LOF");
    expect(text).not.toContain("ROT");
    expect(text).not.toContain("0.5");
    expect(body.due_now.every((t: { customer_visible: number | null }) => t.customer_visible !== 0)).toBe(true);
  });

  it("keeps the customer grid free of hidden tasks and mapped prices", async () => {
    const query = new URLSearchParams({
      year: String(LOOKUP.year),
      model: LOOKUP.model,
      trim: LOOKUP.trim,
      engine: LOOKUP.engine,
      engineSize: LOOKUP.engineSize,
      drivetrain: LOOKUP.drivetrain,
      transmission: LOOKUP.transmission,
      drivingCondition: LOOKUP.drivingCondition,
      currentMileage: String(LOOKUP.currentMileage),
    });
    const res = await app.inject({ method: "GET", url: `/api/maintenance/grid?${query}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const text = JSON.stringify(body);

    expect(body.rows.map((row: { taskName: string }) => row.taskName)).not.toContain("Rotate tires");
    expect(text).not.toContain("2995");
    expect(text).not.toContain("ROT");
    expect(text).not.toContain("HIDDEN ROTATION");
    for (const row of body.rows) {
      for (const detail of row.details) expect(detail.menu_price_cents).toBeNull();
    }
  });

  it("keeps the full customer timeline free of hidden and internal dealership data", async () => {
    const query = new URLSearchParams({
      year: String(LOOKUP.year),
      model: LOOKUP.model,
      trim: LOOKUP.trim,
      engine: LOOKUP.engine,
      engineSize: LOOKUP.engineSize,
      drivetrain: LOOKUP.drivetrain,
      transmission: LOOKUP.transmission,
      drivingCondition: LOOKUP.drivingCondition,
      currentMileage: String(LOOKUP.currentMileage),
      range: "full",
    });
    const res = await app.inject({ method: "GET", url: `/api/maintenance/grid?${query}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const text = JSON.stringify(body);

    expect(body.rows.map((row: { taskName: string }) => row.taskName)).not.toContain("Rotate tires");
    expect(text).not.toContain("2995");
    expect(text).not.toContain("HIDDEN ROTATION");
    expect(text).not.toContain("ROT");
    expect(text).not.toContain("0.3");
    for (const row of body.rows) {
      for (const detail of row.details) expect(detail.menu_price_cents).toBeNull();
    }
  });

  it("returns a public guide with no hidden or internal dealership data", async () => {
    const res = await app.inject({ method: "POST", url: "/api/maintenance/guide", payload: LOOKUP });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const text = JSON.stringify(body);

    expect(body.guide.sections.some((section: { internal?: boolean }) => section.internal)).toBe(false);
    expect(text).not.toContain("Rotate tires");
    expect(text).not.toContain("HIDDEN ROTATION");
    expect(text).not.toContain("2995");
    expect(text).not.toContain("ROT");
    expect(text).not.toContain("27T");
    expect(text).not.toContain("0.3");
    expect(JSON.stringify(body.guide)).not.toContain("317848a5f55d37ab8609e561e336899bc3bab32b");
  });
});
