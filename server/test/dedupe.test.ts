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

/**
 * B1 regression — the audit's blocking finding.
 *
 * Live data carries some maintenance lines under two service_ids: two task
 * rows with identical customer-visible fields, both edged to the same config
 * (repro: 2020 Sienna SE Premium AWD Severe @30k — "Inspect transmission for
 * signs of leakage" x2). The fixture slice has no such twin, so this test
 * MANUFACTURES one — a second task row + edge with a larger task_key and a
 * different service_id — and asserts the display layer collapses it while the
 * database keeps both rows.
 */
let tmp: string;
let app: FastifyInstance;
let dbPath: string;
let configKey: string;
let originalKey: string;
const TWIN_KEY = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"; // sorts after any hex key

beforeAll(async () => {
  expect(existsSync(buildScript), "run `npm run build -w etl` before tests").toBe(true);
  tmp = mkdtempSync(join(tmpdir(), "tmc-dedupe-"));
  dbPath = join(tmp, "fixture.db");
  execFileSync("node", [buildScript, "--data-dir", join(repoRoot, "fixtures"), "--out", dbPath], { stdio: "pipe" });

  // Inject the twin BEFORE the server opens the DB read-only.
  const db = new Database(dbPath);
  const cfg = db.prepare(
    `SELECT config_key FROM vehicle_configs
     WHERE year=2020 AND model='4RUNNER' AND trim='SR5' AND drivetrain='4WD' AND driving_condition='Normal'`,
  ).get() as { config_key: string };
  configKey = cfg.config_key;

  const orig = db.prepare(
    `SELECT mt.* FROM schedule_task_edges e JOIN maintenance_tasks mt USING (task_key)
     WHERE e.config_key=? AND mt.task_name='Rotate tires' AND mt.interval_miles=70000 LIMIT 1`,
  ).get(configKey) as Record<string, unknown> & { task_key: string };
  expect(orig, "fixture must contain Rotate tires @70000 for this config").toBeTruthy();
  originalKey = orig.task_key;

  db.prepare(
    `INSERT INTO maintenance_tasks
       (task_key, task_name, description, service_id, category, priority, menu,
        interval_miles, interval_months, source, source_item_json, use_count, created_at)
     VALUES (@task_key, @task_name, @description, @service_id, @category, @priority, @menu,
             @interval_miles, @interval_months, @source, @source_item_json, @use_count, @created_at)`,
  ).run({ ...orig, task_key: TWIN_KEY, service_id: "twin-service-id" });
  db.prepare("INSERT INTO schedule_task_edges (config_key, task_key) VALUES (?, ?)").run(configKey, TWIN_KEY);
  db.close();

  app = buildApp({ dbPath });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  rmSync(tmp, { recursive: true, force: true });
});

const LOOKUP = {
  year: 2020, model: "4RUNNER", trim: "SR5", drivetrain: "4WD",
  drivingCondition: "Normal", currentMileage: 70000,
};

describe("B1: duplicate task rows collapse at the display layer", () => {
  it("keeps both rows in the database (raw data untouched)", () => {
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare(
      `SELECT mt.task_key FROM schedule_task_edges e JOIN maintenance_tasks mt USING (task_key)
       WHERE e.config_key=? AND mt.task_name='Rotate tires' AND mt.interval_miles=70000
       ORDER BY mt.task_key`,
    ).all(configKey) as Array<{ task_key: string }>;
    expect(rows).toHaveLength(2); // dedupe is display-only; provenance preserved
    expect(rows.map((r) => r.task_key)).toEqual([originalKey, TWIN_KEY]);
    db.close();
  });

  it("due_now contains exactly one row, the MIN(task_key) representative", async () => {
    const res = await app.inject({ method: "POST", url: "/api/maintenance/lookup", payload: LOOKUP });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const rotates = body.due_now.filter((t: { task_name: string }) => t.task_name === "Rotate tires");
    expect(rotates).toHaveLength(1);
    expect(rotates[0].task_key).toBe(originalKey); // deterministic survivor
    // Same task at OTHER intervals must not be collapsed away.
    const anyOther = body.upcoming.some((t: { task_name: string }) => t.task_name === "Rotate tires");
    expect(anyOther).toBe(true);
  });

  it("grid does not regress: one Rotate tires row, one detail per cell", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/maintenance/grid?year=2020&model=4RUNNER&trim=SR5&drivetrain=4WD&drivingCondition=Normal&currentMileage=70000`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const grid = body.grid ?? body; // tolerate either envelope; assertion targets dedupe
    const rows = grid.rows.filter((r: { taskName: string }) => r.taskName === "Rotate tires");
    expect(rows).toHaveLength(1);
    const detail70k = rows[0].details.filter((d: Record<string, unknown>) =>
      Object.values(d).includes(70000));
    expect(detail70k).toHaveLength(1); // one detail entry at 70k, not two
    expect(rows[0].cells["70000"]).toBe(true);
  });

  it("guide customer section names the task once", async () => {
    const res = await app.inject({ method: "POST", url: "/api/maintenance/guide", payload: LOOKUP });
    expect(res.statusCode).toBe(200);
    const due = res.json().guide.sections.find((s: { id: string }) => s.id === "due_now");
    const mentions = (due.items ?? []).filter((i: { label: string }) => i.label.includes("Rotate tires"));
    expect(mentions).toHaveLength(1);
  });
});
