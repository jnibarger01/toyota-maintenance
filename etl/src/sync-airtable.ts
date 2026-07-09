/**
 * sync:airtable CLI — Airtable is the admin layer, SQLite is the live backend.
 *
 *   sync:airtable --dry-run   fetch + validate + report; writes nothing
 *   sync:airtable --apply     transactional upserts + sync log
 *   sync:airtable --verify    read-only health checks (no Airtable call)
 *
 * The token is read from AIRTABLE_TOKEN or AIRTABLE_API_KEY and is never
 * printed: config echoes show "set (redacted)", and every error path passes
 * through the client's redaction before reaching stdout/stderr.
 */
import Database from "better-sqlite3";
import { AirtableClient } from "./airtable/client.js";
import { runSync, type SyncReport, type SyncTables } from "./airtable/sync.js";
import { runVerify, type VerifyReport } from "./airtable/verify.js";

export interface CliDeps {
  env: Record<string, string | undefined>;
  argv: string[];
  print: (line: string) => void;
  fetchImpl?: ConstructorParameters<typeof AirtableClient>[0]["fetchImpl"];
  sleepImpl?: (ms: number) => Promise<void>;
}

const USAGE =
  "usage: sync:airtable (--dry-run | --apply | --verify) [--db <path>]\n" +
  "env:   AIRTABLE_TOKEN|AIRTABLE_API_KEY, AIRTABLE_BASE_ID,\n" +
  "       AIRTABLE_MAINTENANCE_SCHEDULES_TABLE (default \"Maintenance Schedules\"),\n" +
  "       AIRTABLE_MAINTENANCE_TASKS_TABLE?, AIRTABLE_SERVICE_MAPPING_TABLE?, TMC_DB";

export function formatSyncReport(r: SyncReport): string {
  const lines = [
    `sync:airtable ${r.mode} — ${r.status.toUpperCase()}  (run ${r.run_id})`,
    `  schedules: seen ${r.schedules_seen} · insert ${r.schedules_inserted} · update ${r.schedules_updated} · skip ${r.schedules_skipped}` +
      (r.mode === "dry-run" ? "  [planned only — nothing written]" : ""),
  ];
  for (const o of r.optional_tables) lines.push(`  optional ${o.kind}: ${o.table} — ${o.note}${o.records !== null ? ` (${o.records} records)` : ""}`);
  for (const w of r.warnings) lines.push(`  WARN  ${w}`);
  for (const e of r.errors) lines.push(`  ERROR ${e}`);
  lines.push(`  started ${r.started_at} · finished ${r.finished_at}`);
  return lines.join("\n");
}

export function formatVerifyReport(v: VerifyReport): string {
  const lines = [`sync:airtable verify — ${v.healthy ? "HEALTHY" : "ISSUES FOUND"}`];
  for (const c of v.checks) lines.push(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
  return lines.join("\n");
}

export async function main(deps: CliDeps): Promise<number> {
  const { env, argv, print } = deps;
  const modes = ["--dry-run", "--apply", "--verify"].filter((m) => argv.includes(m));
  if (modes.length !== 1) { print(USAGE); return 2; }
  const mode = modes[0];

  const dbFlag = argv.indexOf("--db");
  const dbPath = dbFlag !== -1 ? argv[dbFlag + 1] : env["TMC_DB"] ?? "./tmc.db";
  if (!dbPath) { print(USAGE); return 2; }

  if (mode === "--verify") {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const report = runVerify(db);
      print(formatVerifyReport(report));
      return report.healthy ? 0 : 1;
    } finally { db.close(); }
  }

  const token = env["AIRTABLE_TOKEN"] ?? env["AIRTABLE_API_KEY"];
  const baseId = env["AIRTABLE_BASE_ID"];
  if (!token || !baseId) {
    print("missing AIRTABLE_TOKEN/AIRTABLE_API_KEY or AIRTABLE_BASE_ID");
    print(USAGE);
    return 2;
  }
  const tables: SyncTables = {
    schedules: env["AIRTABLE_MAINTENANCE_SCHEDULES_TABLE"] ?? "Maintenance Schedules",
    tasks: env["AIRTABLE_MAINTENANCE_TASKS_TABLE"],
    serviceMappings: env["AIRTABLE_SERVICE_MAPPING_TABLE"],
  };

  print(`config: base ${baseId} · schedules table "${tables.schedules}" · token set (redacted) · db ${dbPath}`);

  const client = new AirtableClient({ token, baseId, fetchImpl: deps.fetchImpl, sleepImpl: deps.sleepImpl });
  const db = new Database(dbPath); // writable: sync is the ONLY writer path here
  try {
    const report = await runSync({ db, client, tables, mode: mode === "--apply" ? "apply" : "dry-run" });
    print(formatSyncReport(report));
    return report.status === "failed" ? 2 : 0;
  } catch (e) {
    // Last-ditch: even unexpected throws leave redacted.
    print(client.redact(e instanceof Error ? (e.stack ?? e.message) : String(e)));
    return 2;
  } finally { db.close(); }
}

// Direct CLI execution (node etl/dist/sync-airtable.js --dry-run)
const isDirect = process.argv[1]?.endsWith("sync-airtable.js");
if (isDirect) {
  main({ env: process.env, argv: process.argv.slice(2), print: (l) => console.log(l) })
    .then((code) => process.exit(code))
    .catch((e) => { console.error(String(e)); process.exit(2); });
}
