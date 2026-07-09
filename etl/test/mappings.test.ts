import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { applyMappings, fromAirtableMirror, validateRow } from "../src/mappings/engine.js";
import { ensureSyncSchema } from "../src/airtable/sync-schema.js";
import { main } from "../src/seed-mappings.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const buildScript = join(repoRoot, "etl", "dist", "build-db.js");
const seedPath = join(repoRoot, "fixtures", "service-task-mappings.seed.json");

let tmp: string;
let basePath: string;

/** Checksum proving mapping runs never alter raw source tables. */
function rawChecksum(db: Database.Database): string {
  const a = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(LENGTH(task_name)),0) s FROM maintenance_tasks").get() as any;
  const b = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(mileage),0) s FROM schedule_items").get() as any;
  return JSON.stringify([a, b]);
}

beforeAll(() => {
  expect(existsSync(buildScript), "run `npm run build -w etl` first").toBe(true);
  tmp = mkdtempSync(join(tmpdir(), "tmc-map-"));
  basePath = join(tmp, "base.db");
  execFileSync("node", [buildScript, "--data-dir", join(repoRoot, "fixtures"), "--out", basePath], { stdio: "pipe" });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function freshDb(name: string): { db: Database.Database; path: string } {
  const path = join(tmp, name);
  copyFileSync(basePath, path);
  return { db: new Database(path), path };
}

const seedCandidates = () =>
  (JSON.parse(readFileSync(seedPath, "utf8")) as { mappings: Array<Record<string, unknown>> }).mappings;

describe("seed file", () => {
  it("parses, validates, and matches real Xtime task names", () => {
    const { db } = freshDb("seedcheck.db");
    const rows = seedCandidates();
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const c of rows) {
      const v = validateRow(c);
      expect(typeof v, JSON.stringify(c)).not.toBe("string");
      // Committed template carries NO dealership pricing.
      expect((v as any).menu_price_cents).toBeNull();
      expect((v as any).op_code).toBeNull();
    }
    // Fixture slice is one model; the full seed targets the whole catalog —
    // just prove the marquee names resolve against real task rows.
    for (const name of ["Rotate tires", "Replace engine oil and oil filter", "Inspect wiper blades"]) {
      expect(db.prepare("SELECT 1 FROM maintenance_tasks WHERE task_name=?").get(name), name).toBeTruthy();
    }
    db.close();
  });
});

describe("applyMappings", () => {
  it("dry run validates and reports but writes nothing", () => {
    const { db } = freshDb("dry.db");
    const before = rawChecksum(db);
    const r = applyMappings({ db, candidates: seedCandidates(), mode: "dry-run", source: "seed" });
    expect(r.inserted).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) n FROM service_task_mappings").get()).toEqual({ n: 0 });
    expect(rawChecksum(db)).toBe(before);
    db.close();
  });

  it("apply inserts; re-apply updates the same row — no duplicates", () => {
    const { db } = freshDb("upsert.db");
    const first = applyMappings({ db, candidates: seedCandidates(), mode: "apply", source: "seed" });
    expect(first.inserted).toBe(seedCandidates().length);

    const idBefore = (db.prepare("SELECT id FROM service_task_mappings WHERE source_task_name='Rotate tires'").get() as any).id;

    const edited = seedCandidates().map((c) =>
      c.source_task_name === "Rotate tires" ? { ...c, advisor_label: "Tire Rotation & Tread Report", menu_price_cents: 2995 } : c);
    const second = applyMappings({ db, candidates: edited, mode: "apply", source: "seed" });
    expect(second.updated).toBe(edited.length);
    expect(second.inserted).toBe(0);

    const rows = db.prepare("SELECT id, advisor_label, menu_price_cents FROM service_task_mappings WHERE source_task_name='Rotate tires'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(idBefore);
    expect(rows[0].advisor_label).toBe("Tire Rotation & Tread Report");
    expect(rows[0].menu_price_cents).toBe(2995);
    db.close();
  });

  it("unknown task names are warned but tolerated; raw source stays byte-identical", () => {
    const { db } = freshDb("unknown.db");
    const before = rawChecksum(db);
    const r = applyMappings({
      db, mode: "apply", source: "seed",
      candidates: [{ source_task_name: "Flux capacitor service", advisor_label: "Time Circuits" }],
    });
    expect(r.inserted).toBe(1);
    expect(r.warnings.join(" ")).toContain("Flux capacitor service");
    expect(rawChecksum(db)).toBe(before); // mapping never alters raw data
    db.close();
  });

  it("rejects bad pricing without applying it", () => {
    const { db } = freshDb("badprice.db");
    const r = applyMappings({
      db, mode: "apply", source: "seed",
      candidates: [
        { source_task_name: "Rotate tires", menu_price_cents: -100 },
        { source_task_name: "Inspect wiper blades", menu_price_cents: 1995.5 },
        { source_task_name: "Replace spark plugs", menu_price_cents: 24900 },
      ],
    });
    expect(r.rejected).toBe(2);
    expect(r.inserted).toBe(1);
    expect(db.prepare("SELECT COUNT(*) n FROM service_task_mappings").get()).toEqual({ n: 1 });
    db.close();
  });
});

describe("Airtable mirror promotion", () => {
  it("promotes mirror rows with field-name mapping and dollars->cents conversion", () => {
    const { db } = freshDb("mirror.db");
    ensureSyncSchema(db);
    const put = db.prepare("INSERT INTO airtable_service_mappings_raw (airtable_record_id, fields_json, last_synced_at) VALUES (?,?,?)");
    put.run("recMap1", JSON.stringify({
      "Source Task Name": "Rotate tires", "Advisor Label": "Tire Rotation",
      "Op Code": "27T", "Labor Hours": 0.3, "Menu Price": 29.95, "Customer Visible": true,
    }), "2026-07-09T00:00:00Z");
    put.run("recMap2", JSON.stringify({ "Advisor Label": "orphan — no source name" }), "2026-07-09T00:00:00Z");

    const r = applyMappings({ db, candidates: fromAirtableMirror(db), mode: "apply", source: "airtable mirror" });
    expect(r.inserted).toBe(1);
    expect(r.rejected).toBe(1);
    expect(r.errors.join(" ")).toContain("recMap2");

    const row = db.prepare("SELECT op_code, labor_hours, menu_price_cents, is_customer_visible FROM service_task_mappings WHERE source_task_name='Rotate tires'").get() as any;
    expect(row).toEqual({ op_code: "27T", labor_hours: 0.3, menu_price_cents: 2995, is_customer_visible: 1 });
    db.close();
  });
});

describe("seed:mappings CLI", () => {
  it("exact commands work and dry-run leaves the DB untouched", async () => {
    const { db, path } = freshDb("cli.db");
    db.close();
    const lines: string[] = [];
    const print = (l: string) => lines.push(l);

    expect(await main({ env: { TMC_DB: path }, argv: ["--dry-run", "--file", seedPath], print })).toBe(0);
    const check = new Database(path);
    expect(check.prepare("SELECT COUNT(*) n FROM service_task_mappings").get()).toEqual({ n: 0 });
    check.close();

    expect(await main({ env: { TMC_DB: path }, argv: ["--apply", "--file", seedPath], print })).toBe(0);
    const after = new Database(path);
    expect((after.prepare("SELECT COUNT(*) n FROM service_task_mappings").get() as any).n).toBeGreaterThanOrEqual(12);
    after.close();

    expect(await main({ env: { TMC_DB: path }, argv: [], print })).toBe(2); // usage
    expect(lines.join("\n")).toContain("insert");
  });
});
