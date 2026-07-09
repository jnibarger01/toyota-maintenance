/**
 * Schema hardening guarantees (v0.2): indexes, single-row meta, views,
 * FK enforcement, and the no-VIN/no-price contract on ingestion tables.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
  tmp = mkdtempSync(join(tmpdir(), "tmc-schema-"));
  dbPath = join(tmp, "fixture.db");
  execFileSync("node", [buildScript, "--data-dir", fixtures, "--out", dbPath], { stdio: "pipe" });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const cols = (db: InstanceType<typeof Database>, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

describe("schema v0.2 guarantees", () => {
  it("has the required lookup indexes", () => {
    const db = new Database(dbPath, { readonly: true });
    const names = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>)
        .map((r) => r.name),
    );
    for (const idx of [
      "idx_configs_year", "idx_configs_year_model", "idx_configs_year_model_trim",
      "idx_configs_schedule_hash", "idx_configs_condition",
      "idx_tasks_interval_miles", "idx_tasks_category", "idx_tasks_priority", "idx_tasks_menu", "idx_tasks_name",
      "idx_edges_config", "idx_edges_task",
      "idx_items_hash_mileage",
      "idx_templates_item_count", "idx_templates_mileage_count", "idx_templates_is_empty",
      "idx_mappings_source_name", "idx_mappings_category",
    ]) {
      expect(names.has(idx), `missing index ${idx}`).toBe(true);
    }
    db.close();
  });

  it("enforces exactly one import_meta row", () => {
    const db = new Database(dbPath); // writable on purpose — the tmp copy, never the live DB
    expect(() =>
      db.prepare("INSERT INTO import_meta (id, built_at, etl_version, artifact_manifest_json) VALUES (2,'x','x','[]')").run()
    ).toThrow(/CHECK/i);
    db.close();
  });

  it("exposes the option views and the due reporting view", () => {
    const db = new Database(dbPath, { readonly: true });
    const years = (db.prepare("SELECT year FROM vehicle_option_years").all() as Array<{ year: number }>).map((r) => r.year);
    expect(years).toContain(2020);
    const models = db.prepare("SELECT * FROM vehicle_option_models WHERE year=2020 AND model='4RUNNER'").all();
    expect(models.length).toBe(1);
    const due = db.prepare(
      "SELECT task_name, interval_miles, menu FROM maintenance_due_view WHERE config_key = ?"
    ).all("317848a5f55d37ab8609e561e336899bc3bab32b") as Array<{ task_name: string }>;
    expect(due.length).toBeGreaterThan(0);
    expect(due[0].task_name.length).toBeGreaterThan(0);
    db.close();
  });

  it("declares and enforces FKs on schedule_task_edges", () => {
    const db = new Database(dbPath);
    const fks = db.prepare("PRAGMA foreign_key_list(schedule_task_edges)").all();
    expect(fks.length).toBe(2);
    db.pragma("foreign_keys = ON");
    expect(() =>
      db.prepare("INSERT INTO schedule_task_edges (config_key, task_key) VALUES ('nope','nope')").run()
    ).toThrow(/FOREIGN KEY/i);
    db.close();
  });

  it("keeps VIN/customer/price/labor/fee out of every source ingestion table", () => {
    const db = new Database(dbPath, { readonly: true });
    const forbidden = new Set(["vin", "price", "prices", "labor", "fee", "fees", "customer"]);
    for (const table of [
      "vehicle_configs", "schedule_templates", "schedule_items",
      "maintenance_tasks", "schedule_task_edges", "artifact_files", "import_meta", "import_warnings",
    ]) {
      for (const c of cols(db, table)) {
        for (const token of c.toLowerCase().split("_")) {
          expect(forbidden.has(token), `forbidden column ${table}.${c}`).toBe(false);
        }
      }
    }
    db.close();
  });

  it("confines pricing/labor to the dealership-owned mapping table, empty after ETL", () => {
    const db = new Database(dbPath, { readonly: true });
    const c = cols(db, "service_task_mappings");
    expect(c).toContain("menu_price_cents");
    expect(c).toContain("labor_hours");
    expect(c).toContain("op_code");
    const n = (db.prepare("SELECT COUNT(*) n FROM service_task_mappings").get() as { n: number }).n;
    expect(n).toBe(0);
    db.close();
  });

  it("flags empty templates via is_empty (fixture slice has none)", () => {
    const db = new Database(dbPath, { readonly: true });
    const bad = (db.prepare("SELECT COUNT(*) n FROM schedule_templates WHERE is_empty NOT IN (0,1)").get() as { n: number }).n;
    expect(bad).toBe(0);
    const empty = (db.prepare("SELECT COUNT(*) n FROM schedule_templates WHERE is_empty = 1").get() as { n: number }).n;
    expect(empty).toBe(0);
    db.close();
  });
});
