/**
 * build-db: JSONL artifacts -> SQLite lookup DB (schema v0.2).
 *
 * Usage:
 *   node etl/dist/build-db.js --data-dir /path/to/artifacts --out ./tmc.db [--skip-edges]
 *
 * Expected files in --data-dir:
 *   airtable_schedules_import.jsonl        (7.2k configs x condition; carries task_keys + Description metadata)
 *   unique_schedule_templates.jsonl        (deduped content by Schedule Hash; carries raw Schedule JSON)
 *   airtable_tasks_import.jsonl            (deduped task catalog with source_item)
 *   airtable_schedule_task_edges.jsonl     (config_key -> task_key; Airtable link audit)
 *   airtable_schedule_create_success.jsonl (Airtable record ids + created_at provenance)
 *
 * Fail-closed invariants (non-zero exit, partial DB deleted, on violation):
 *   - Description.Config Key === schedule_key for every schedule
 *   - every config's Schedule Hash exists in templates
 *   - engine strings parse into type/size(/variant)
 *   - no duplicate vehicle configuration (UNIQUE constraint)
 *   - every edge references a known config and task (FK enforced)
 *
 * Non-fatal anomalies land in import_warnings (empty templates, provenance
 * coverage gaps, skipped edge loads).
 *
 * Source-fidelity contract: no VIN, customer, price, labor, or fee data
 * exists upstream or is introduced here. Pricing belongs exclusively to the
 * dealership-owned service_task_mappings table, which this ETL never writes.
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, existsSync, mkdirSync, rmSync, openSync, readSync, closeSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDescriptionMeta, splitEngine, gridStats, type ScheduleItem } from "./lib.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ETL_VERSION = "0.2.0";

interface Args { dataDir: string; out: string; skipEdges: boolean }
function parseArgs(argv: string[]): Args {
  const a: Args = { dataDir: "data", out: "tmc.db", skipEdges: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--data-dir") a.dataDir = argv[++i];
    else if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--skip-edges") a.skipEdges = true;
    else throw new Error(`Unknown arg: ${argv[i]}`);
  }
  return a;
}

const FILES = {
  schedules: "airtable_schedules_import.jsonl",
  templates: "unique_schedule_templates.jsonl",
  tasks: "airtable_tasks_import.jsonl",
  edges: "airtable_schedule_task_edges.jsonl",
  createSuccess: "airtable_schedule_create_success.jsonl",
} as const;

async function* lines(path: string): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim().length > 0) yield line;
}

interface FileFacts { sha256: string; byteCount: number; lineCount: number }

/** Single streamed pass: sha256 + byte count + newline-delimited line count. */
function hashCountFile(path: string): FileFacts {
  const h = createHash("sha256");
  const CHUNK = 8 * 1024 * 1024;
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(CHUNK);
  let n: number;
  let bytes = 0;
  let newlines = 0;
  let lastByte = 0x0a;
  while ((n = readSync(fd, buf, 0, CHUNK, null)) > 0) {
    const view = buf.subarray(0, n);
    h.update(view);
    bytes += n;
    for (let i = 0; i < n; i++) if (view[i] === 0x0a) newlines++;
    lastByte = view[n - 1];
  }
  closeSync(fd);
  const lineCount = newlines + (bytes > 0 && lastByte !== 0x0a ? 1 : 0);
  return { sha256: h.digest("hex"), byteCount: bytes, lineCount };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = resolve(args.dataDir);
  const outPath = resolve(args.out);
  const t0 = Date.now();
  const builtAt = new Date().toISOString();

  for (const f of Object.values(FILES)) {
    const p = join(dataDir, f);
    if (!existsSync(p)) {
      if (f === FILES.edges && args.skipEdges) continue;
      throw new Error(`Missing artifact: ${p}`);
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) rmSync(outPath + suffix, { force: true });

  const db = new Database(outPath);
  db.pragma("journal_mode = MEMORY");
  db.pragma("synchronous = OFF");
  db.exec(readFileSync(join(__dirname, "schema.sql"), "utf8"));
  db.pragma("foreign_keys = ON");

  const errors: string[] = [];
  const stats: Record<string, number> = {};
  const warnings: Array<{ severity: "info" | "warning" | "error"; code: string; message: string; sourceFile?: string; lineNo?: number; context?: unknown }> = [];

  function failClosed(): never {
    console.error(`FAIL-CLOSED: ${errors.length} integrity error(s):`);
    for (const e of errors) console.error("  " + e);
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(outPath + suffix, { force: true });
    process.exit(1);
  }

  // ---- 1. Templates + exploded schedule_items (FK parents come first) -------
  const insTpl = db.prepare(`INSERT INTO schedule_templates
    (schedule_hash, service_item_count, mileage_point_count, schedule_json, schedule_text,
     example_config_key, vehicle_config_count, is_empty, grid_min, grid_max, grid_step, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insItem = db.prepare(`INSERT INTO schedule_items
    (schedule_hash, mileage, months, menu, service_id, service_name, description, category, priority, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  const templateHashes = new Set<string>();
  const emptyTemplateHashes: string[] = [];
  let tplCount = 0, itemCount = 0;
  db.exec("BEGIN");
  for await (const line of lines(join(dataDir, FILES.templates))) {
    const o = JSON.parse(line) as Record<string, unknown>;
    const hash = String(o["Schedule Hash"]);
    const rawJson = String(o["Schedule JSON"]);
    const items = JSON.parse(rawJson) as ScheduleItem[];
    const g = gridStats(items);
    const isEmpty = items.length === 0 ? 1 : 0;
    if (isEmpty) emptyTemplateHashes.push(hash);
    insTpl.run(
      hash,
      Number(o["Service Item Count"]),
      Number(o["Mileage Point Count"]),
      rawJson,
      (o["Schedule Text"] as string) ?? null,
      (o["Example Config Key"] as string) ?? null,
      o["Vehicle Config Count"] != null ? Number(o["Vehicle Config Count"]) : null,
      isEmpty,
      g.min, g.max, g.step,
      builtAt,
    );
    for (const it of items) {
      insItem.run(hash, it.mileage, it.months, it.menu, it.service_id ?? null, it.service_name,
        it.description || null, it.category ?? null, it.priority ?? null, it.order ?? null);
      itemCount++;
    }
    templateHashes.add(hash);
    tplCount++;
  }
  db.exec("COMMIT");
  stats.schedule_templates = tplCount;
  stats.schedule_items = itemCount;
  if (emptyTemplateHashes.length > 0) {
    warnings.push({
      severity: "warning",
      code: "EMPTY_TEMPLATES",
      message: `${emptyTemplateHashes.length} schedule template(s) contain zero service items; dependent configs will surface schedule_empty`,
      sourceFile: FILES.templates,
      context: { schedule_hashes: emptyTemplateHashes },
    });
  }

  // ---- 2. Vehicle configs (fail-closed on contract violations) --------------
  const insCfg = db.prepare(`INSERT INTO vehicle_configs
    (config_key, year, make, model, trim, drivetrain, engine, engine_type, engine_size, engine_variant,
     transmission, driving_condition, schedule_hash, schedule_name, source, raw_description, last_updated,
     created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  let cfgCount = 0;
  db.exec("BEGIN");
  for await (const line of lines(join(dataDir, FILES.schedules))) {
    const o = JSON.parse(line) as { schedule_key: string; fields: Record<string, unknown> };
    const f = o.fields;
    try {
      const rawDescription = String(f["Description"]);
      const meta = parseDescriptionMeta(rawDescription);
      if (meta.configKey !== o.schedule_key) {
        throw new Error(`Config Key mismatch: description=${meta.configKey} line=${o.schedule_key}`);
      }
      if (!templateHashes.has(meta.scheduleHash)) {
        throw new Error(`Schedule Hash not found in templates: ${meta.scheduleHash}`);
      }
      const eng = splitEngine(meta.engine);
      insCfg.run(
        o.schedule_key,
        Number(f["Year"]), meta.make, String(f["Model"]), String(f["Trim"]),
        String(f["Drivetrain"]), meta.engine, eng.engineType, eng.engineSize, eng.engineVariant,
        meta.transmission, meta.drivingCondition,
        meta.scheduleHash, String(f["Schedule Name"]), meta.source, rawDescription,
        (f["Last Updated"] as string) ?? null,
        builtAt, builtAt,
      );
      cfgCount++;
    } catch (e) {
      errors.push(`config ${o.schedule_key}: ${(e as Error).message}`);
      if (errors.length > 20) break;
    }
  }
  db.exec("COMMIT");
  stats.vehicle_configs = cfgCount;

  // Contract violations mean nothing downstream is trustworthy — stop here.
  if (errors.length > 0) failClosed();

  // ---- 3. Maintenance tasks ---------------------------------------------------
  const insTask = db.prepare(`INSERT INTO maintenance_tasks
    (task_key, task_name, description, service_id, category, priority, menu,
     interval_miles, interval_months, source, source_item_json, use_count, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let taskCount = 0;
  db.exec("BEGIN");
  for await (const line of lines(join(dataDir, FILES.tasks))) {
    const o = JSON.parse(line) as { task_key: string; fields: Record<string, unknown>; source_item?: Record<string, unknown>; use_count?: number };
    const si = o.source_item ?? {};
    insTask.run(
      o.task_key,
      String(o.fields["Task Name"]),
      (si["description"] as string) || null,
      si["service_id"] != null ? String(si["service_id"]) : null,
      (si["category"] as string) ?? null,
      (si["priority"] as string) ?? null,
      (si["menu"] as string) ?? null,
      o.fields["Interval (Miles)"] != null ? Number(o.fields["Interval (Miles)"]) : null,
      si["months"] != null ? Number(si["months"]) : null,
      "Xtime",
      o.source_item ? JSON.stringify(o.source_item) : null,
      o.use_count ?? null,
      builtAt,
    );
    taskCount++;
  }
  db.exec("COMMIT");
  stats.maintenance_tasks = taskCount;

  // ---- 4. Edges (FK-enforced: unknown config/task keys are fatal) ------------
  if (!args.skipEdges && existsSync(join(dataDir, FILES.edges))) {
    const insEdge = db.prepare("INSERT OR IGNORE INTO schedule_task_edges (config_key, task_key) VALUES (?,?)");
    let edgeCount = 0;
    db.exec("BEGIN");
    for await (const line of lines(join(dataDir, FILES.edges))) {
      const o = JSON.parse(line) as { schedule_key: string; task_key: string };
      try {
        insEdge.run(o.schedule_key, o.task_key);
        edgeCount++;
      } catch (e) {
        errors.push(`edge ${o.schedule_key}->${o.task_key}: ${(e as Error).message}`);
        if (errors.length > 20) break;
      }
      if (edgeCount % 500000 === 0) { db.exec("COMMIT"); db.exec("BEGIN"); }
    }
    db.exec("COMMIT");
    stats.schedule_task_edges = edgeCount;
    if (errors.length > 0) failClosed();
  } else if (args.skipEdges) {
    warnings.push({
      severity: "info",
      code: "EDGES_SKIPPED",
      message: "--skip-edges: schedule_task_edges not loaded; maintenance_due_view will be empty",
      sourceFile: FILES.edges,
    });
  }

  // ---- 5. Airtable provenance -> vehicle_configs ------------------------------
  const updProv = db.prepare(
    "UPDATE vehicle_configs SET airtable_record_id = ?, airtable_created_at = ?, updated_at = ? WHERE config_key = ?"
  );
  let provMatched = 0, provOrphans = 0;
  db.exec("BEGIN");
  for await (const line of lines(join(dataDir, FILES.createSuccess))) {
    const o = JSON.parse(line) as { schedule_key: string; record_id?: string; created_at?: string; line_no?: number };
    const info = updProv.run(o.record_id ?? null, o.created_at ?? null, builtAt, o.schedule_key);
    if (info.changes === 1) provMatched++;
    else provOrphans++;
  }
  db.exec("COMMIT");
  stats.provenance_matched = provMatched;
  if (provOrphans > 0) {
    warnings.push({
      severity: "warning",
      code: "PROVENANCE_ORPHANS",
      message: `${provOrphans} Airtable success row(s) reference unknown config_keys`,
      sourceFile: FILES.createSuccess,
    });
  }
  if (provMatched < cfgCount) {
    warnings.push({
      severity: "warning",
      code: "PROVENANCE_COVERAGE",
      message: `Airtable provenance covers ${provMatched}/${cfgCount} configs`,
      sourceFile: FILES.createSuccess,
      context: { matched: provMatched, configs: cfgCount },
    });
  }

  // ---- 6. Artifact audit + single-row import metadata -------------------------
  const insFile = db.prepare(
    "INSERT INTO artifact_files (filename, sha256, line_count, byte_count, loaded_at) VALUES (?,?,?,?,?)"
  );
  const manifest: Array<{ filename: string } & FileFacts> = [];
  for (const file of Object.values(FILES)) {
    const p = join(dataDir, file);
    if (!existsSync(p)) continue; // only possible for edges under --skip-edges
    const facts = hashCountFile(p);
    insFile.run(file, facts.sha256, facts.lineCount, facts.byteCount, new Date().toISOString());
    manifest.push({ filename: file, ...facts });
  }
  db.prepare(
    "INSERT INTO import_meta (id, built_at, etl_version, source_dir, artifact_manifest_json) VALUES (1,?,?,?,?)"
  ).run(builtAt, ETL_VERSION, dataDir, JSON.stringify(manifest));

  const insWarn = db.prepare(`INSERT INTO import_warnings
    (severity, code, message, source_file, line_no, context_json, created_at) VALUES (?,?,?,?,?,?,?)`);
  for (const w of warnings) {
    insWarn.run(w.severity, w.code, w.message, w.sourceFile ?? null, w.lineNo ?? null,
      w.context !== undefined ? JSON.stringify(w.context) : null, builtAt);
  }
  stats.import_warnings = warnings.length;

  db.pragma("journal_mode = WAL");
  db.pragma("optimize");
  db.close();

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`OK  ${outPath}  (${secs}s, etl ${ETL_VERSION})`);
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(22)} ${v}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
