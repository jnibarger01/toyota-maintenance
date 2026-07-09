import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const fixtures = join(repoRoot, "fixtures");
const buildScript = join(repoRoot, "etl", "dist", "build-db.js");

let tmp: string;
let dbPath: string;

beforeAll(() => {
  expect(existsSync(buildScript), "run `npm run build -w etl` before tests").toBe(true);
  tmp = mkdtempSync(join(tmpdir(), "tmc-etl-"));
  dbPath = join(tmp, "fixture.db");
  execFileSync("node", [buildScript, "--data-dir", fixtures, "--out", dbPath], { stdio: "pipe" });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("build-db against 2020 4Runner fixtures (DoD #1, schema v0.2)", () => {
  it("creates all tables with expected row counts", () => {
    const db = new Database(dbPath, { readonly: true });
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    expect(n("SELECT COUNT(*) n FROM vehicle_configs")).toBe(24);
    expect(n("SELECT COUNT(*) n FROM schedule_templates")).toBe(4);
    expect(n("SELECT COUNT(*) n FROM maintenance_tasks")).toBe(730);
    expect(n("SELECT COUNT(*) n FROM schedule_task_edges")).toBe(8536);
    expect(n("SELECT COUNT(*) n FROM schedule_items")).toBeGreaterThan(0);
    expect(n("SELECT COUNT(*) n FROM artifact_files")).toBe(5);
    // Airtable provenance is absorbed into vehicle_configs — full coverage on fixtures.
    expect(n("SELECT COUNT(*) n FROM vehicle_configs WHERE airtable_record_id IS NOT NULL")).toBe(24);
    db.close();
  });

  it("preserves config_key, schedule_hash, source, and Airtable provenance", () => {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare(
      `SELECT config_key, schedule_hash, source, last_updated, raw_description,
              airtable_record_id, airtable_created_at
       FROM vehicle_configs
       WHERE trim='SR5' AND drivetrain='4WD' AND driving_condition='Normal'`
    ).get() as Record<string, string>;
    expect(row.config_key).toBe("317848a5f55d37ab8609e561e336899bc3bab32b");
    expect(row.source).toBe("Xtime");
    expect(row.schedule_hash).toHaveLength(64);
    expect(row.raw_description).toContain("Config Key: 317848a5f55d37ab8609e561e336899bc3bab32b");
    expect(row.airtable_record_id).toMatch(/^rec/);
    expect(row.airtable_created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    db.close();
  });

  it("keeps raw schedule JSON for audit and it round-trips as valid JSON", () => {
    const db = new Database(dbPath, { readonly: true });
    const tpl = db.prepare("SELECT schedule_json, is_empty FROM schedule_templates LIMIT 1")
      .get() as { schedule_json: string; is_empty: number };
    const items = JSON.parse(tpl.schedule_json) as Array<{ mileage: number; service_name: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("mileage");
    expect(items[0]).toHaveProperty("service_name");
    expect(tpl.is_empty).toBe(0);
    db.close();
  });

  it("records single-row import_meta and per-file artifact audit", () => {
    const db = new Database(dbPath, { readonly: true });
    const meta = db.prepare("SELECT * FROM import_meta").all() as Array<Record<string, unknown>>;
    expect(meta).toHaveLength(1);
    expect(meta[0].id).toBe(1);
    expect(String(meta[0].built_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta[0].etl_version).toBe("0.2.0");
    const manifest = JSON.parse(String(meta[0].artifact_manifest_json)) as Array<{ filename: string; sha256: string }>;
    expect(manifest).toHaveLength(5);

    const files = db.prepare("SELECT * FROM artifact_files").all() as Array<Record<string, unknown>>;
    expect(files).toHaveLength(5);
    for (const f of files) {
      expect(String(f.sha256)).toMatch(/^[0-9a-f]{64}$/);
      expect(Number(f.line_count)).toBeGreaterThan(0);
      expect(Number(f.byte_count)).toBeGreaterThan(0);
      expect(String(f.loaded_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    db.close();
  });

  it("splits engine into type and size", () => {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare(
      "SELECT DISTINCT engine, engine_type, engine_size FROM vehicle_configs"
    ).get() as { engine: string; engine_type: string; engine_size: string };
    expect(row.engine).toBe("V6 4.0L");
    expect(row.engine_type).toBe("V6");
    expect(row.engine_size).toBe("4.0L");
    db.close();
  });
});
