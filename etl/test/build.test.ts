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

describe("build-db against 2020 4Runner fixtures (DoD #1)", () => {
  it("creates all tables with expected row counts", () => {
    const db = new Database(dbPath, { readonly: true });
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    expect(n("SELECT COUNT(*) n FROM vehicle_schedules")).toBe(24);
    expect(n("SELECT COUNT(*) n FROM schedule_templates")).toBe(4);
    expect(n("SELECT COUNT(*) n FROM schedule_provenance")).toBe(24);
    expect(n("SELECT COUNT(*) n FROM tasks")).toBe(730);
    expect(n("SELECT COUNT(*) n FROM schedule_task_edges")).toBe(8536);
    expect(n("SELECT COUNT(*) n FROM schedule_items")).toBeGreaterThan(0);
    db.close();
  });

  it("preserves schedule_key, schedule_hash, source, and Airtable provenance", () => {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare(
      `SELECT vs.schedule_key, vs.schedule_hash, vs.source, vs.last_updated,
              sp.airtable_record_id, sp.airtable_created_at
       FROM vehicle_schedules vs JOIN schedule_provenance sp USING (schedule_key)
       WHERE vs.trim='SR5' AND vs.drivetrain='4WD' AND vs.driving_condition='Normal'`
    ).get() as Record<string, string>;
    expect(row.schedule_key).toBe("317848a5f55d37ab8609e561e336899bc3bab32b");
    expect(row.source).toBe("Xtime");
    expect(row.schedule_hash).toHaveLength(64);
    expect(row.airtable_record_id).toMatch(/^rec/);
    expect(row.airtable_created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    db.close();
  });

  it("keeps raw schedule JSON for audit and it round-trips as valid JSON", () => {
    const db = new Database(dbPath, { readonly: true });
    const tpl = db.prepare("SELECT raw_json FROM schedule_templates LIMIT 1").get() as { raw_json: string };
    const items = JSON.parse(tpl.raw_json) as Array<{ mileage: number; service_name: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("mileage");
    expect(items[0]).toHaveProperty("service_name");
    db.close();
  });

  it("records import metadata: built_at + source file hashes", () => {
    const db = new Database(dbPath, { readonly: true });
    const meta = Object.fromEntries(
      (db.prepare("SELECT key, value FROM import_meta").all() as Array<{ key: string; value: string }>)
        .map((r) => [r.key, r.value]),
    );
    expect(meta["built_at"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta["source_sha256:airtable_schedules_import.jsonl"]).toMatch(/^[0-9a-f]{64}$/);
    db.close();
  });

  it("splits engine into type and size", () => {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare(
      "SELECT DISTINCT engine, engine_type, engine_size FROM vehicle_schedules"
    ).get() as { engine: string; engine_type: string; engine_size: string };
    expect(row.engine).toBe("V6 4.0L");
    expect(row.engine_type).toBe("V6");
    expect(row.engine_size).toBe("4.0L");
    db.close();
  });
});
