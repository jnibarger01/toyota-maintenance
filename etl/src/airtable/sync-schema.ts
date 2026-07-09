/**
 * Schema for the Airtable admin-sync layer.
 *
 * Airtable is an ADMIN/EDITING surface only; SQLite is the live lookup backend.
 * These tables are a mirror + audit trail. Customer lookup NEVER reads Airtable
 * and never depends on this module. Idempotent: safe to ensure on any DB,
 * including the live artifact-built database, without touching lookup tables.
 */
import type Database from "better-sqlite3";

export const SYNC_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS maintenance_schedules (
  id                       INTEGER PRIMARY KEY,
  schedule_key             TEXT NOT NULL UNIQUE,
  airtable_record_id       TEXT,
  description              TEXT,
  normalized_payload_json  TEXT,
  raw_source_json          TEXT,
  source_updated_at        TEXT,
  last_synced_at           TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msched_record ON maintenance_schedules(airtable_record_id);

CREATE TABLE IF NOT EXISTS airtable_sync_log (
  id                  INTEGER PRIMARY KEY,
  run_id              TEXT NOT NULL,
  mode                TEXT NOT NULL CHECK (mode IN ('dry-run','apply','verify')),
  status              TEXT NOT NULL CHECK (status IN ('success','partial','failed')),
  schedules_seen      INTEGER NOT NULL DEFAULT 0,
  schedules_inserted  INTEGER NOT NULL DEFAULT 0,
  schedules_updated   INTEGER NOT NULL DEFAULT 0,
  schedules_skipped   INTEGER NOT NULL DEFAULT 0,
  warnings_json       TEXT NOT NULL DEFAULT '[]',
  errors_json         TEXT NOT NULL DEFAULT '[]',
  started_at          TEXT NOT NULL,
  finished_at         TEXT
);

-- Raw mirrors for the optional admin tables (kept verbatim; promotion into
-- dealership-owned tables like service_task_mappings is a deliberate,
-- separate step — the sync never invents column mappings).
CREATE TABLE IF NOT EXISTS airtable_tasks_raw (
  airtable_record_id TEXT PRIMARY KEY,
  fields_json        TEXT NOT NULL,
  last_synced_at     TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS airtable_service_mappings_raw (
  airtable_record_id TEXT PRIMARY KEY,
  fields_json        TEXT NOT NULL,
  last_synced_at     TEXT NOT NULL
) WITHOUT ROWID;
`;

export function ensureSyncSchema(db: Database.Database): void {
  db.exec(SYNC_SCHEMA_SQL);
}
