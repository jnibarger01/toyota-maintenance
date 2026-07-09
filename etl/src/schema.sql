-- toyota-maintenance-cockpit lookup DB schema
-- Runtime is READ-ONLY. Built offline by etl/build-db from JSONL artifacts.
-- Design: vehicle_schedules (7.2k rows, one per config x driving condition)
--         -> schedule_templates (1.8k rows, deduped content by schedule_hash, raw JSON preserved)
--         -> schedule_items (expanded per-hash rows for fast mileage lookup)

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS import_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_templates (
  schedule_hash       TEXT PRIMARY KEY,        -- content hash from extraction pipeline
  service_item_count  INTEGER NOT NULL,
  mileage_point_count INTEGER NOT NULL,
  grid_min            INTEGER NOT NULL,
  grid_max            INTEGER NOT NULL,
  grid_step           INTEGER NOT NULL,        -- min consecutive interval on the grid
  vehicle_config_count INTEGER,                -- how many configs share this template (from artifact)
  example_config_key  TEXT,
  raw_json            TEXT NOT NULL,           -- verbatim "Schedule JSON" for audit/debug
  schedule_text       TEXT                     -- verbatim "Schedule Text" (human readable)
);

CREATE TABLE IF NOT EXISTS vehicle_schedules (
  schedule_key      TEXT PRIMARY KEY,          -- Xtime config key (identity of config x condition)
  schedule_hash     TEXT NOT NULL REFERENCES schedule_templates(schedule_hash),
  year              INTEGER NOT NULL,
  make              TEXT NOT NULL,
  model             TEXT NOT NULL,
  trim              TEXT NOT NULL,
  engine            TEXT NOT NULL,             -- full string, e.g. 'V6 4.0L', 'I4 2.4L - Turbo'
  engine_type       TEXT NOT NULL,             -- 'V6'
  engine_size       TEXT NOT NULL,             -- '4.0L'
  engine_variant    TEXT,                      -- 'Turbo' | 'FFV' | NULL
  drivetrain        TEXT NOT NULL,
  transmission      TEXT NOT NULL,
  driving_condition TEXT NOT NULL CHECK (driving_condition IN ('Normal','Severe')),
  schedule_name     TEXT NOT NULL,
  source            TEXT NOT NULL,             -- 'Xtime'
  last_updated      TEXT,                      -- from artifact 'Last Updated'
  UNIQUE (year, model, trim, engine, drivetrain, transmission, driving_condition)
);

CREATE INDEX IF NOT EXISTS idx_vs_cascade
  ON vehicle_schedules (year, model, trim, engine, drivetrain, transmission, driving_condition);
CREATE INDEX IF NOT EXISTS idx_vs_hash ON vehicle_schedules (schedule_hash);

CREATE TABLE IF NOT EXISTS schedule_items (
  id            INTEGER PRIMARY KEY,
  schedule_hash TEXT NOT NULL REFERENCES schedule_templates(schedule_hash),
  mileage       INTEGER NOT NULL,
  months        INTEGER,                        -- always NULL in current Xtime extract; kept for schema stability
  menu          TEXT NOT NULL,                  -- 'Normal' | 'Severe' (mirrors driving_condition)
  service_id    TEXT,
  service_name  TEXT NOT NULL,
  description   TEXT,
  category      TEXT,
  priority      TEXT,
  sort_order    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_items_hash_mileage
  ON schedule_items (schedule_hash, mileage);

-- Deduped task catalog (Airtable admin-side reference; source_item preserved verbatim)
CREATE TABLE IF NOT EXISTS tasks (
  task_key       TEXT PRIMARY KEY,
  task_name      TEXT NOT NULL,
  interval_miles INTEGER,
  category       TEXT,
  priority       TEXT,
  menu           TEXT,
  service_id     TEXT,
  use_count      INTEGER,
  raw_json       TEXT NOT NULL                 -- full artifact line (fields + source_item)
);

-- schedule_key -> task_key edges (Airtable link audit; not used in customer lookup path)
CREATE TABLE IF NOT EXISTS schedule_task_edges (
  schedule_key TEXT NOT NULL,
  task_key     TEXT NOT NULL,
  PRIMARY KEY (schedule_key, task_key)
) WITHOUT ROWID;

-- Airtable sync provenance (record ids + created timestamps from create_success artifact)
CREATE TABLE IF NOT EXISTS schedule_provenance (
  schedule_key        TEXT PRIMARY KEY REFERENCES vehicle_schedules(schedule_key),
  airtable_record_id  TEXT,
  airtable_created_at TEXT,
  import_line_no      INTEGER
);
