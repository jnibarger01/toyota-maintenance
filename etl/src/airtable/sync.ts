/**
 * Airtable -> SQLite sync engine.
 *
 * dry-run: fetch + validate + report planned inserts/updates/skips; writes NOTHING.
 * apply:   transactional upserts by schedule_key + a sync-log row.
 *
 * Fail-soft per record (missing key -> warn + skip), fail-soft per OPTIONAL
 * table (warn + partial), fail-hard only when the schedules pull itself dies —
 * and even then a failed log row is recorded on apply.
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { AirtableClient, type AirtableRecord } from "./client.js";
import { ensureSyncSchema } from "./sync-schema.js";
import { extractScheduleKey, descriptionOf } from "./extract.js";

export type SyncMode = "dry-run" | "apply";

export interface SyncTables {
  schedules: string;
  tasks?: string;
  serviceMappings?: string;
}

export interface SyncReport {
  run_id: string;
  mode: SyncMode;
  status: "success" | "partial" | "failed";
  schedules_seen: number;
  schedules_inserted: number;
  schedules_updated: number;
  schedules_skipped: number;
  optional_tables: Array<{ table: string; kind: "tasks" | "service_mappings"; records: number | null; note: string }>;
  warnings: string[];
  errors: string[];
  started_at: string;
  finished_at: string;
}

interface PlannedRow {
  record: AirtableRecord;
  key: string;
  action: "insert" | "update";
}

function sourceUpdatedAt(r: AirtableRecord): string | null {
  const f = r.fields["Last Modified"] ?? r.fields["last_modified"];
  if (typeof f === "string" && f) return f;
  return r.createdTime ?? null;
}

function normalizedPayload(r: AirtableRecord, key: string): string {
  return JSON.stringify({
    schedule_key: key,
    name: typeof r.fields["Name"] === "string" ? r.fields["Name"] : null,
    description: descriptionOf(r),
    fields_present: Object.keys(r.fields).sort(),
  });
}

export async function runSync(opts: {
  db: Database.Database;
  client: AirtableClient;
  tables: SyncTables;
  mode: SyncMode;
  now?: () => Date;
}): Promise<SyncReport> {
  const { db, client, tables, mode } = opts;
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runId = randomUUID();
  const warnings: string[] = [];
  const errors: string[] = [];
  const report: SyncReport = {
    run_id: runId, mode, status: "success",
    schedules_seen: 0, schedules_inserted: 0, schedules_updated: 0, schedules_skipped: 0,
    optional_tables: [], warnings, errors,
    started_at: startedAt, finished_at: startedAt,
  };

  // Dry-run writes NOTHING — not even schema creation. Only apply ensures tables.
  const hasMirror = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_schedules'").get();
  if (mode === "apply") ensureSyncSchema(db);

  // ---- 1) Schedules (required source) --------------------------------------
  let planned: PlannedRow[] = [];
  try {
    const records = await client.listAll(tables.schedules);
    report.schedules_seen = records.length;

    const existing = new Set<string>(
      hasMirror || mode === "apply"
        ? (db.prepare("SELECT schedule_key FROM maintenance_schedules").all() as Array<{ schedule_key: string }>)
            .map((r) => r.schedule_key)
        : [],
    );
    const seenInBatch = new Set<string>();

    for (const rec of records) {
      const { key } = extractScheduleKey(rec);
      if (!key) {
        report.schedules_skipped++;
        warnings.push(client.redact(`record ${rec.id}: no schedule_key/config_key field and none parseable from Description — skipped`));
        continue;
      }
      const isUpdate = existing.has(key) || seenInBatch.has(key);
      if (seenInBatch.has(key)) {
        warnings.push(client.redact(`record ${rec.id}: duplicate schedule_key ${key} within this pull — later record wins`));
      }
      seenInBatch.add(key);
      planned.push({ record: rec, key, action: isUpdate ? "update" : "insert" });
      if (isUpdate) report.schedules_updated++; else report.schedules_inserted++;
    }
  } catch (e) {
    const msg = client.redact(e instanceof Error ? e.message : String(e));
    errors.push(`schedules sync failed: ${msg}`);
    report.status = "failed";
    report.finished_at = now().toISOString();
    if (mode === "apply") writeLog(db, report); // best-effort failure record
    return report;
  }

  // ---- 2) Optional sources (absence must never fail the schedules sync) ----
  const optional: Array<{ table: string | undefined; kind: "tasks" | "service_mappings"; mirror: string }> = [
    { table: tables.tasks, kind: "tasks", mirror: "airtable_tasks_raw" },
    { table: tables.serviceMappings, kind: "service_mappings", mirror: "airtable_service_mappings_raw" },
  ];
  const mirrors = new Map<string, AirtableRecord[]>();
  for (const o of optional) {
    if (!o.table) {
      report.optional_tables.push({ table: "(not configured)", kind: o.kind, records: null, note: "skipped — env var not set" });
      continue;
    }
    try {
      const recs = await client.listAll(o.table);
      mirrors.set(o.mirror, recs);
      report.optional_tables.push({ table: o.table, kind: o.kind, records: recs.length, note: mode === "apply" ? "mirrored" : "would mirror" });
    } catch (e) {
      const msg = client.redact(e instanceof Error ? e.message : String(e));
      warnings.push(`optional table "${o.table}" (${o.kind}) unavailable: ${msg} — schedules sync unaffected`);
      report.optional_tables.push({ table: o.table, kind: o.kind, records: null, note: "unavailable — skipped" });
    }
  }

  if (warnings.length > 0) report.status = "partial";

  // ---- 3) Dry run stops here: fetched, validated, reported — wrote nothing --
  if (mode === "dry-run") {
    report.finished_at = now().toISOString();
    return report;
  }

  // ---- 4) Apply: transactional upserts + mirrors + sync log ----------------
  const iso = now().toISOString();
  const upsert = db.prepare(`
    INSERT INTO maintenance_schedules
      (schedule_key, airtable_record_id, description, normalized_payload_json,
       raw_source_json, source_updated_at, last_synced_at, created_at, updated_at)
    VALUES (@schedule_key, @airtable_record_id, @description, @normalized_payload_json,
            @raw_source_json, @source_updated_at, @last_synced_at, @created_at, @updated_at)
    ON CONFLICT(schedule_key) DO UPDATE SET
      airtable_record_id      = excluded.airtable_record_id,
      description             = excluded.description,
      normalized_payload_json = excluded.normalized_payload_json,
      raw_source_json         = excluded.raw_source_json,
      source_updated_at       = excluded.source_updated_at,
      last_synced_at          = excluded.last_synced_at,
      updated_at              = excluded.updated_at
  `);
  const mirrorUpsert = (t: string) => db.prepare(`
    INSERT INTO ${t} (airtable_record_id, fields_json, last_synced_at)
    VALUES (?, ?, ?)
    ON CONFLICT(airtable_record_id) DO UPDATE SET fields_json = excluded.fields_json, last_synced_at = excluded.last_synced_at
  `);

  try {
    db.transaction(() => {
      for (const p of planned) {
        upsert.run({
          schedule_key: p.key,
          airtable_record_id: p.record.id,
          description: descriptionOf(p.record),
          normalized_payload_json: normalizedPayload(p.record, p.key),
          raw_source_json: JSON.stringify(p.record),
          source_updated_at: sourceUpdatedAt(p.record),
          last_synced_at: iso,
          created_at: iso,
          updated_at: iso,
        });
      }
      for (const [mirror, recs] of mirrors) {
        const stmt = mirrorUpsert(mirror);
        for (const r of recs) stmt.run(r.id, JSON.stringify(r.fields), iso);
      }
    })();
  } catch (e) {
    errors.push(client.redact(`apply transaction failed: ${e instanceof Error ? e.message : String(e)}`));
    report.status = "failed";
  }

  report.finished_at = now().toISOString();
  writeLog(db, report);
  return report;
}

function writeLog(db: Database.Database, r: SyncReport): void {
  try {
    db.prepare(`
      INSERT INTO airtable_sync_log
        (run_id, mode, status, schedules_seen, schedules_inserted, schedules_updated,
         schedules_skipped, warnings_json, errors_json, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      r.run_id, r.mode, r.status, r.schedules_seen, r.schedules_inserted, r.schedules_updated,
      r.schedules_skipped, JSON.stringify(r.warnings), JSON.stringify(r.errors), r.started_at, r.finished_at,
    );
  } catch {
    /* logging must never mask the sync outcome */
  }
}
