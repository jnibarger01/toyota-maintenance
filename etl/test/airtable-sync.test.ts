import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AirtableClient, type AirtableRecord } from "../src/airtable/client.js";
import { runSync } from "../src/airtable/sync.js";
import { runVerify } from "../src/airtable/verify.js";
import { extractScheduleKey } from "../src/airtable/extract.js";
import { main } from "../src/sync-airtable.js";

const TOKEN = "patSECRETtokenXYZ123";
const BASE = "appTESTBASE";
const K1 = "a".repeat(40);
const K2 = "b".repeat(40);
const K3 = "c".repeat(40);

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "tmc-sync-"));
  dbPath = join(tmp, "sync.db");
  new Database(dbPath).close(); // empty DB file exists
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

type Scripted = { status: number; body?: unknown; headers?: Record<string, string> };

/** Fake fetch: scripted responses per table, records every request. */
function fakeFetch(script: Record<string, Scripted[]>) {
  const calls: Array<{ url: string; auth: string | undefined }> = [];
  const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, auth: init?.headers?.["Authorization"] });
    const table = decodeURIComponent(new URL(url).pathname.split("/").pop()!);
    const queue = script[table];
    if (!queue || queue.length === 0) return new Response(JSON.stringify({ error: "unscripted" }), { status: 500 });
    const next = queue.shift()!;
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status, headers: next.headers });
  };
  return { fetchImpl, calls };
}

const rec = (id: string, fields: Record<string, unknown>): AirtableRecord =>
  ({ id, createdTime: "2026-07-01T00:00:00.000Z", fields });

function client(fetchImpl: any, sleeps?: number[], maxRetries?: number) {
  return new AirtableClient({
    token: TOKEN, baseId: BASE, fetchImpl,
    sleepImpl: async (ms) => { sleeps?.push(ms); },
    maxRetries,
  });
}

const TABLES = { schedules: "Maintenance Schedules" };

describe("airtable client", () => {
  it("paginates with offset until exhausted (test 4)", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "Maintenance Schedules": [
        { status: 200, body: { records: [rec("r1", { schedule_key: K1 }), rec("r2", { schedule_key: K2 })], offset: "o1" } },
        { status: 200, body: { records: [rec("r3", { schedule_key: K3 })] } },
      ],
    });
    const out = await client(fetchImpl).listAll("Maintenance Schedules");
    expect(out).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("offset=o1");
    expect(calls[0].auth).toBe(`Bearer ${TOKEN}`); // sent to Airtable, never anywhere else
  });

  it("handles 429 with Retry-After and retries transient 5xx (tests 5, 12, 13)", async () => {
    const sleeps: number[] = [];
    const { fetchImpl } = fakeFetch({
      T: [
        { status: 429, headers: { "Retry-After": "2" } },
        { status: 503 },
        { status: 200, body: { records: [rec("r1", { schedule_key: K1 })] } },
      ],
    });
    const out = await client(fetchImpl, sleeps).listAll("T");
    expect(out).toHaveLength(1);
    expect(sleeps[0]).toBe(2000);          // Retry-After honored (seconds -> ms)
    expect(sleeps[1]).toBeGreaterThan(0);  // exponential backoff for the 503
  });

  it("gives up after bounded retries with a redacted error", async () => {
    const { fetchImpl } = fakeFetch({ T: Array(10).fill({ status: 429, body: { error: `limit ${TOKEN}` } }) });
    await expect(client(fetchImpl, [], 2).listAll("T")).rejects.toThrow(/Airtable 429/);
    await client(fetchImpl, [], 0).listAll("T").catch((e: Error) => {
      expect(e.message).not.toContain(TOKEN);
      expect(e.message).toContain("***REDACTED***");
    });
  });
});

describe("schedule_key extraction (test 3 prerequisites)", () => {
  it("prefers explicit fields, falls back to Description parsing", () => {
    expect(extractScheduleKey(rec("r", { schedule_key: K1 }))).toEqual({ key: K1, via: "field" });
    expect(extractScheduleKey(rec("r", { "Config Key": K2.toUpperCase() }))).toEqual({ key: K2, via: "field" });
    expect(extractScheduleKey(rec("r", { Description: `Schedule Key: ${K3}\nYear: 2020` }))).toEqual({ key: K3, via: "description" });
    expect(extractScheduleKey(rec("r", { Description: `2020 4RUNNER [${K1}] Normal` }))).toEqual({ key: K1, via: "description" });
    expect(extractScheduleKey(rec("r", { Description: "no key here", Name: "x" }))).toEqual({ key: null, via: null });
  });
});

describe("runSync", () => {
  const threeRecords = () => ({
    "Maintenance Schedules": [{
      status: 200,
      body: { records: [
        rec("recA", { schedule_key: K1, Description: "2020 4RUNNER SR5", Name: "A" }),
        rec("recB", { Description: `Config Key: ${K2}` }),
        rec("recC", { Name: "no key at all" }),
      ] },
    }],
  });

  it("dry run fetches, validates, reports — and performs no writes (tests 1, 3)", async () => {
    const db = new Database(dbPath);
    const { fetchImpl } = fakeFetch(threeRecords());
    const report = await runSync({ db, client: client(fetchImpl), tables: TABLES, mode: "dry-run" });

    expect(report.mode).toBe("dry-run");
    expect(report.schedules_seen).toBe(3);
    expect(report.schedules_inserted).toBe(2);
    expect(report.schedules_skipped).toBe(1);
    expect(report.status).toBe("partial"); // the skip produced a warning
    expect(report.warnings.join(" ")).toContain("recC");

    // Nothing written — not rows, not the log, not even the tables themselves.
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).not.toContain("maintenance_schedules");
    expect(tables.map((t) => t.name)).not.toContain("airtable_sync_log");
    db.close();
  });

  it("apply upserts transactionally, preserves record_id, writes the sync log (tests 2, 3)", async () => {
    const db = new Database(dbPath);
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 6, 9, 12, 0, tick++));
    const { fetchImpl } = fakeFetch(threeRecords());
    const r1 = await runSync({ db, client: client(fetchImpl), tables: TABLES, mode: "apply", now });
    expect(r1.schedules_inserted).toBe(2);
    expect(r1.schedules_skipped).toBe(1);

    const rowA = db.prepare("SELECT * FROM maintenance_schedules WHERE schedule_key=?").get(K1) as any;
    expect(rowA.airtable_record_id).toBe("recA");
    expect(rowA.description).toBe("2020 4RUNNER SR5");
    expect(JSON.parse(rowA.normalized_payload_json).schedule_key).toBe(K1);
    const createdAt = rowA.created_at;

    // Second apply: same key, changed content -> duplicate schedule_key UPDATES the row.
    const { fetchImpl: f2 } = fakeFetch({
      "Maintenance Schedules": [{ status: 200, body: { records: [rec("recA2", { schedule_key: K1, Description: "edited in Airtable" })] } }],
    });
    const r2 = await runSync({ db, client: client(f2), tables: TABLES, mode: "apply", now });
    expect(r2.schedules_updated).toBe(1);
    expect(r2.schedules_inserted).toBe(0);

    const after = db.prepare("SELECT * FROM maintenance_schedules WHERE schedule_key=?").get(K1) as any;
    expect(after.description).toBe("edited in Airtable");
    expect(after.airtable_record_id).toBe("recA2");
    expect(after.created_at).toBe(createdAt);          // preserved
    expect(after.updated_at).not.toBe(createdAt);      // moved
    expect(db.prepare("SELECT COUNT(*) n FROM maintenance_schedules WHERE schedule_key=?").get(K1)).toEqual({ n: 1 });

    const logs = db.prepare("SELECT mode, status, schedules_inserted, schedules_updated FROM airtable_sync_log ORDER BY id").all();
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ mode: "apply", schedules_inserted: 2 });
    expect(logs[1]).toMatchObject({ mode: "apply", schedules_updated: 1 });
    db.close();
  });

  it("duplicate schedule_key within one pull: later record wins, counted as update (test 2)", async () => {
    const db = new Database(dbPath);
    const { fetchImpl } = fakeFetch({
      "Maintenance Schedules": [{ status: 200, body: { records: [
        rec("first", { schedule_key: K1, Description: "v1" }),
        rec("second", { schedule_key: K1, Description: "v2" }),
      ] } }],
    });
    const r = await runSync({ db, client: client(fetchImpl), tables: TABLES, mode: "apply" });
    expect(r.schedules_inserted).toBe(1);
    expect(r.schedules_updated).toBe(1);
    expect(r.warnings.join(" ")).toContain("duplicate schedule_key");
    const row = db.prepare("SELECT airtable_record_id, description FROM maintenance_schedules WHERE schedule_key=?").get(K1) as any;
    expect(row).toEqual({ airtable_record_id: "second", description: "v2" });
    db.close();
  });

  it("optional tables: missing does not fail schedules; present gets mirrored (test 8)", async () => {
    const db = new Database(dbPath);
    const { fetchImpl } = fakeFetch({
      "Maintenance Schedules": [{ status: 200, body: { records: [rec("recA", { schedule_key: K1 })] } }],
      "Maintenance Tasks": [{ status: 404, body: { error: "TABLE_NOT_FOUND" } }],
      "Service Task Mappings": [{ status: 200, body: { records: [rec("map1", { "Op Code": "27T" })] } }],
    });
    const r = await runSync({
      db, client: client(fetchImpl),
      tables: { schedules: "Maintenance Schedules", tasks: "Maintenance Tasks", serviceMappings: "Service Task Mappings" },
      mode: "apply",
    });
    expect(r.status).toBe("partial");
    expect(r.schedules_inserted).toBe(1); // schedules unaffected by the 404
    expect(r.warnings.join(" ")).toContain("Maintenance Tasks");
    expect(db.prepare("SELECT COUNT(*) n FROM airtable_service_mappings_raw").get()).toEqual({ n: 1 });
    db.close();
  });

  it("schedules failure on apply records a failed log row and mutates nothing else", async () => {
    const db = new Database(dbPath);
    const { fetchImpl } = fakeFetch({ "Maintenance Schedules": Array(10).fill({ status: 429 }) });
    const r = await runSync({ db, client: client(fetchImpl, [], 1), tables: TABLES, mode: "apply" });
    expect(r.status).toBe("failed");
    expect(db.prepare("SELECT COUNT(*) n FROM maintenance_schedules").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT status FROM airtable_sync_log ORDER BY id DESC LIMIT 1").get()).toEqual({ status: "failed" });
    db.close();
  });
});

describe("verify (test: read-only health)", () => {
  it("reports healthy after an apply, without mutating data", async () => {
    const db = new Database(dbPath);
    const { fetchImpl } = fakeFetch({
      "Maintenance Schedules": [{ status: 200, body: { records: [rec("recA", { schedule_key: K1 })] } }],
    });
    await runSync({ db, client: client(fetchImpl), tables: TABLES, mode: "apply" });
    const before = db.prepare("SELECT COUNT(*) n FROM airtable_sync_log").get() as { n: number };

    const v = runVerify(db);
    expect(v.healthy).toBe(true);
    expect(v.checks.find((c) => c.name === "mirror populated")?.ok).toBe(true);

    expect(db.prepare("SELECT COUNT(*) n FROM airtable_sync_log").get()).toEqual(before); // no log row from verify
    db.close();
  });

  it("flags an unsynced database as unhealthy", () => {
    const db = new Database(dbPath);
    const v = runVerify(db);
    expect(v.healthy).toBe(false);
    db.close();
  });
});

describe("CLI surface + token hygiene (test 6)", () => {
  const env = {
    AIRTABLE_TOKEN: TOKEN,
    AIRTABLE_BASE_ID: BASE,
    AIRTABLE_MAINTENANCE_SCHEDULES_TABLE: "Maintenance Schedules",
  };

  it("the exact commands work: --dry-run, --apply, --verify", async () => {
    const lines: string[] = [];
    const print = (l: string) => lines.push(l);
    const script = () => fakeFetch({
      "Maintenance Schedules": [{ status: 200, body: { records: [rec("recA", { schedule_key: K1 })] } }],
    }).fetchImpl;

    expect(await main({ env: { ...env, TMC_DB: dbPath }, argv: ["--dry-run"], print, fetchImpl: script() })).toBe(0);
    expect(await main({ env: { ...env, TMC_DB: dbPath }, argv: ["--apply"], print, fetchImpl: script() })).toBe(0);
    expect(await main({ env: { TMC_DB: dbPath }, argv: ["--verify"], print })).toBe(0); // verify needs no Airtable env
    expect(await main({ env, argv: [], print })).toBe(2); // usage
    expect(lines.join("\n")).toContain("HEALTHY");
  });

  it("the token never appears in logs, errors, reports, or CLI output — even when Airtable echoes it", async () => {
    const lines: string[] = [];
    const print = (l: string) => lines.push(l);

    // Adversarial: Airtable error bodies and network errors that CONTAIN the token.
    const evilFetch = async (url: string) => {
      if (url.includes("offset=never")) throw new Error("unreachable");
      return new Response(JSON.stringify({ error: `bad auth for ${TOKEN}` }), { status: 401 });
    };
    const code = await main({ env: { ...env, TMC_DB: dbPath }, argv: ["--apply"], print, fetchImpl: evilFetch as any });
    expect(code).toBe(2);

    const everything = lines.join("\n");
    expect(everything).not.toContain(TOKEN);
    expect(everything).toContain("token set (redacted)");
    expect(everything).toContain("***REDACTED***");

    // Thrown-error path is redacted too.
    const c = client(evilFetch as any, [], 0);
    await c.listAll("Maintenance Schedules").catch((e: Error) => {
      expect(e.message).not.toContain(TOKEN);
    });

    // And the structured report is clean.
    const db = new Database(dbPath);
    const r = await runSync({ db, client: c, tables: TABLES, mode: "dry-run" });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    db.close();
  });
});
