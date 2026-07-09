/**
 * seed:mappings CLI — apply dealership-owned service task mappings.
 *
 *   seed:mappings --dry-run [--file <json>] [--from-airtable-mirror] [--db <path>]
 *   seed:mappings --apply   [--file <json>] [--from-airtable-mirror] [--db <path>]
 *
 * Mapping is an overlay: raw Xtime tables are never modified, unknown names
 * are warned but tolerated, and pricing enters ONLY through this
 * dealership-owned path (seed file or the Airtable mirror).
 */
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { applyMappings, fromAirtableMirror, type MappingReport } from "./mappings/engine.js";

export interface CliDeps {
  env: Record<string, string | undefined>;
  argv: string[];
  print: (line: string) => void;
}

const USAGE =
  "usage: seed:mappings (--dry-run | --apply) [--file <seed.json>] [--from-airtable-mirror] [--db <path>]\n" +
  "default seed file: fixtures/service-task-mappings.seed.json";

export function formatMappingReport(r: MappingReport): string {
  const lines = [
    `seed:mappings ${r.mode} — source: ${r.source}`,
    `  rows ${r.rows_seen} · insert ${r.inserted} · update ${r.updated} · reject ${r.rejected}` +
      (r.mode === "dry-run" ? "  [planned only — nothing written]" : ""),
  ];
  for (const w of r.warnings) lines.push(`  WARN  ${w}`);
  for (const e of r.errors) lines.push(`  ERROR ${e}`);
  return lines.join("\n");
}

export async function main(deps: CliDeps): Promise<number> {
  const { env, argv, print } = deps;
  const modes = ["--dry-run", "--apply"].filter((m) => argv.includes(m));
  if (modes.length !== 1) { print(USAGE); return 2; }
  const mode = modes[0] === "--apply" ? "apply" : "dry-run";

  const dbFlag = argv.indexOf("--db");
  const dbPath = dbFlag !== -1 ? argv[dbFlag + 1] : env["TMC_DB"] ?? "./tmc.db";
  const fileFlag = argv.indexOf("--file");
  const filePath = fileFlag !== -1 ? argv[fileFlag + 1] : "fixtures/service-task-mappings.seed.json";
  const useMirror = argv.includes("--from-airtable-mirror");

  const db = new Database(dbPath);
  try {
    let candidates: Array<Record<string, unknown>>;
    let source: string;
    if (useMirror) {
      const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='airtable_service_mappings_raw'").get();
      if (!has) { print("airtable_service_mappings_raw not found — run sync:airtable --apply first"); return 2; }
      candidates = fromAirtableMirror(db);
      source = "airtable mirror";
    } else {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { mappings?: unknown };
      if (!Array.isArray(parsed.mappings)) { print(`no "mappings" array in ${filePath}`); return 2; }
      candidates = parsed.mappings as Array<Record<string, unknown>>;
      source = filePath;
    }

    const report = applyMappings({ db, candidates, mode, source });
    print(formatMappingReport(report));
    return report.errors.length > 0 && report.inserted + report.updated === 0 ? 2 : 0;
  } catch (e) {
    print(e instanceof Error ? e.message : String(e));
    return 2;
  } finally { db.close(); }
}

const isDirect = process.argv[1]?.endsWith("seed-mappings.js");
if (isDirect) {
  main({ env: process.env, argv: process.argv.slice(2), print: (l) => console.log(l) })
    .then((code) => process.exit(code))
    .catch((e) => { console.error(String(e)); process.exit(2); });
}
