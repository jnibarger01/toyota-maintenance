-- Toyota Maintenance Cockpit — SQLite schema v0.2 (schema hardening)
--
-- Contract:
--   * Source ingestion tables carry NO VIN, NO customer data, NO prices,
--     NO labor, NO fees — the Xtime extraction excludes them and this schema
--     keeps it that way. Pricing/labor live ONLY in service_task_mappings,
--     which is dealership-owned display data, never populated by the ETL.
--   * config_key (a.k.a. schedule_key upstream) and schedule_hash are
--     preserved verbatim. Raw schedule JSON is preserved verbatim.
--   * The API opens this DB read-only; nothing here requires Airtable at
--     runtime — airtable_* columns are inert provenance.

PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------------------
-- 1. import_meta — exactly one row per built database.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_meta (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  built_at               TEXT NOT NULL,
  etl_version            TEXT NOT NULL,
  source_dir             TEXT,
  artifact_manifest_json TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 2. artifact_files — the exact source files this DB was built from.
--    line_count = physical newline-delimited lines consumed by the loader.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifact_files (
  filename   TEXT PRIMARY KEY,
  sha256     TEXT NOT NULL,
  line_count INTEGER NOT NULL,
  byte_count INTEGER NOT NULL,
  loaded_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 4 (declared before configs for FK ordering). schedule_templates —
--    deduped schedule content keyed by content hash.
--    grid_min/grid_max/grid_step are retained beyond the required field set:
--    the due-lookup engine snaps odometer readings against them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedule_templates (
  schedule_hash        TEXT PRIMARY KEY,
  service_item_count   INTEGER NOT NULL,
  mileage_point_count  INTEGER NOT NULL,
  schedule_json        TEXT NOT NULL,           -- raw Xtime schedule item array, verbatim
  schedule_text        TEXT,
  example_config_key   TEXT,
  vehicle_config_count INTEGER DEFAULT 0,
  is_empty             INTEGER NOT NULL DEFAULT 0 CHECK (is_empty IN (0,1)),
  grid_min             INTEGER NOT NULL DEFAULT 0,
  grid_max             INTEGER NOT NULL DEFAULT 0,
  grid_step            INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_item_count    ON schedule_templates(service_item_count);
CREATE INDEX IF NOT EXISTS idx_templates_mileage_count ON schedule_templates(mileage_point_count);
CREATE INDEX IF NOT EXISTS idx_templates_is_empty      ON schedule_templates(is_empty);

-- ---------------------------------------------------------------------------
-- 3. vehicle_configs — one row per Toyota vehicle configuration × condition.
--    config_key is the upstream schedule_key, verbatim.
--    engine_variant and last_updated are retained beyond the required field
--    set (option cascade + Airtable "Last Updated" provenance already flow
--    through the API). The UNIQUE constraint is a fail-closed duplicate trap.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_configs (
  config_key          TEXT PRIMARY KEY,
  year                INTEGER NOT NULL,
  make                TEXT NOT NULL DEFAULT 'TOYOTA',
  model               TEXT NOT NULL,
  trim                TEXT,
  drivetrain          TEXT,
  engine              TEXT,
  engine_type         TEXT,
  engine_size         TEXT,
  engine_variant      TEXT,
  transmission        TEXT,
  driving_condition   TEXT NOT NULL CHECK (driving_condition IN ('Normal','Severe')),
  schedule_hash       TEXT NOT NULL REFERENCES schedule_templates(schedule_hash),
  schedule_name       TEXT,
  airtable_record_id  TEXT,
  airtable_created_at TEXT,
  source              TEXT NOT NULL DEFAULT 'Xtime',
  raw_description     TEXT,
  last_updated        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (year, model, trim, engine, drivetrain, transmission, driving_condition)
);

CREATE INDEX IF NOT EXISTS idx_configs_year            ON vehicle_configs(year);
CREATE INDEX IF NOT EXISTS idx_configs_year_model      ON vehicle_configs(year, model);
CREATE INDEX IF NOT EXISTS idx_configs_year_model_trim ON vehicle_configs(year, model, trim);
CREATE INDEX IF NOT EXISTS idx_configs_schedule_hash   ON vehicle_configs(schedule_hash);
CREATE INDEX IF NOT EXISTS idx_configs_condition       ON vehicle_configs(driving_condition);

-- ---------------------------------------------------------------------------
-- schedule_items — per-milestone service items exploded from schedule_json.
--    Internal runtime table (beyond the required set): this is what the
--    mileage due-lookup and the Grid/List/Guide views read. It is a pure
--    derivation of schedule_templates.schedule_json.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedule_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_hash TEXT NOT NULL REFERENCES schedule_templates(schedule_hash),
  mileage       INTEGER NOT NULL,
  months        INTEGER,
  menu          TEXT,
  service_id    TEXT,
  service_name  TEXT NOT NULL,
  description   TEXT,
  category      TEXT,
  priority      TEXT,
  sort_order    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_items_hash_mileage ON schedule_items(schedule_hash, mileage);

-- ---------------------------------------------------------------------------
-- 5. maintenance_tasks — deduped reusable task records (Airtable Tasks table
--    mirror). interval_months is carried for future use; Xtime emits null.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maintenance_tasks (
  task_key         TEXT PRIMARY KEY,
  task_name        TEXT NOT NULL,
  description      TEXT,
  service_id       TEXT,
  category         TEXT,
  priority         TEXT,
  menu             TEXT,
  interval_miles   INTEGER,
  interval_months  INTEGER,
  source           TEXT NOT NULL DEFAULT 'Xtime',
  source_item_json TEXT,                        -- source_item, verbatim
  use_count        INTEGER DEFAULT 0,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_interval_miles ON maintenance_tasks(interval_miles);
CREATE INDEX IF NOT EXISTS idx_tasks_category       ON maintenance_tasks(category);
CREATE INDEX IF NOT EXISTS idx_tasks_priority       ON maintenance_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_menu           ON maintenance_tasks(menu);
CREATE INDEX IF NOT EXISTS idx_tasks_name           ON maintenance_tasks(task_name);

-- ---------------------------------------------------------------------------
-- 6. schedule_task_edges — config ↔ task mapping (Airtable link audit).
--    FK-enforced: an edge naming an unknown config or task aborts the build.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedule_task_edges (
  config_key TEXT NOT NULL,
  task_key   TEXT NOT NULL,
  PRIMARY KEY (config_key, task_key),
  FOREIGN KEY (config_key) REFERENCES vehicle_configs(config_key),
  FOREIGN KEY (task_key)   REFERENCES maintenance_tasks(task_key)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_edges_config ON schedule_task_edges(config_key);
CREATE INDEX IF NOT EXISTS idx_edges_task   ON schedule_task_edges(task_key);

-- ---------------------------------------------------------------------------
-- 7. service_task_mappings — dealership/advisor display layer.
--    THE ONLY TABLE where op codes, labor hours, and menu pricing may live.
--    Owned by the store, never written by the ETL, empty until the store
--    populates it. Cents-integer pricing; no floats for money.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_task_mappings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  source_task_name    TEXT NOT NULL,
  advisor_label       TEXT,
  display_category    TEXT,
  op_code             TEXT,
  labor_hours         REAL,
  menu_price_cents    INTEGER,
  is_customer_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_customer_visible IN (0,1)),
  advisor_note        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mappings_source_name ON service_task_mappings(source_task_name);
CREATE INDEX IF NOT EXISTS idx_mappings_category    ON service_task_mappings(display_category);

-- ---------------------------------------------------------------------------
-- 8. import_warnings — non-fatal diagnostics from the build.
--    Fatal integrity errors never persist: the ETL deletes the DB and exits 1.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_warnings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  severity     TEXT NOT NULL CHECK (severity IN ('info','warning','error')),
  code         TEXT NOT NULL,
  message      TEXT NOT NULL,
  source_file  TEXT,
  line_no      INTEGER,
  context_json TEXT,
  created_at   TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS vehicle_option_years AS
  SELECT DISTINCT year FROM vehicle_configs ORDER BY year DESC;

CREATE VIEW IF NOT EXISTS vehicle_option_models AS
  SELECT DISTINCT year, model FROM vehicle_configs ORDER BY year DESC, model;

-- Task-interval oriented reporting view (advisor/analytics convenience).
-- The runtime mileage-due engine reads schedule_items, not this view.
CREATE VIEW IF NOT EXISTS maintenance_due_view AS
  SELECT
    vc.config_key,
    vc.year,
    vc.model,
    vc.trim,
    vc.drivetrain,
    vc.engine,
    vc.transmission,
    vc.driving_condition,
    mt.interval_miles,
    mt.task_key,
    mt.task_name,
    mt.category,
    mt.priority,
    mt.menu
  FROM vehicle_configs vc
  JOIN schedule_task_edges e  ON e.config_key = vc.config_key
  JOIN maintenance_tasks  mt  ON mt.task_key   = e.task_key;
