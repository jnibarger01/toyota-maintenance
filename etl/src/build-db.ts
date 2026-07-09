/**
 * build-db: JSONL artifacts -> SQLite lookup DB.
 *
 * Usage:
 *   node etl/dist/build-db.js --data-dir /path/to/artifacts --out ./tmc.db [--skip-edges]
 *
 * Expected files in --data-dir:
 *   airtable_schedules_import.jsonl        (7.2k configs x condition; carries task_keys + Description metadata)
 *   unique_schedule_templates.jsonl        (deduped content by Schedule Hash; carries raw Schedule JSON)
 *   airtable_tasks_import.jsonl            (deduped task catalog with source_item)
 *   airtable_schedule_task_edges.jsonl     (schedule_key -> task_key; Airtable link audit)
 *   airtable_schedule_create_success.jsonl (Airtable record ids + created_at provenance)
 *
 * Fail-closed invariants (non-zero exit on violation):
 *   - Description.Config Key === schedule_key for every schedule
 *   - every schedule's Schedule Hash exists in templates
 *   - engine strings parse into type/size(/variant)
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, existsSync, mkdirSync, rmSync, openSync, readSync, closeSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDescriptionMeta, splitEngine, gridStats, type ScheduleItem } from "./lib.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function sha256File(path: string): string {
  // Streamed read keeps memory flat; artifacts top out ~250MB.
  const h = createHash("sha256");
  const CHUNK = 8 * 1024 * 1024;
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(CHUNK);
  let n: number;
  while ((n = readSync(fd, buf, 0, CHUNK, null)) > 0) h.update(buf.subarray(0, n));
  closeSync(fd);
  return h.digest("hex");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = resolve(args.dataDir);
  const outPath = resolve(args.out);
  const t0 = Date.now();

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

  const errors: string[] = [];
  const stats: Record<string, number> = {};

  // ---- 1. Templates (needed first: schedules reference them) ---------------
  const insTpl = db.prepare(`INSERT INTO schedule_templates
    (schedule_hash, service_item_count, mileage_point_count, grid_min, grid_max, grid_step,
     vehicle_config_count, example_config_key, raw_json, schedule_text)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const insItem = db.prepare(`INSERT INTO schedule_items
    (schedule_hash, mileage, months, menu, service_id, service_name, description, category, priority, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  const templateHashes = new Set<string>();
  let tplCount = 0, itemCount = 0;
  db.exec("BEGIN");
  for await (const line of lines(join(dataDir, FILES.templates))) {
    const o = JSON.parse(line) as Record<string, unknown>;
    const hash = String(o["Schedule Hash"]);
    const rawJson = String(o["Schedule JSON"]);
    const items = JSON.parse(rawJson) as ScheduleItem[];
    const g = gridStats(items);
    insTpl.run(
      hash,
      Number(o["Service Item Count"]),
      Number(o["Mileage Point Count"]),
      g.min, g.max, g.step,
      o["Vehicle Config Count"] != null ? Number(o["Vehicle Config Count"]) : null,
      (o["Example Config Key"] as string) ?? null,
      rawJson,
      (o["Schedule Text"] as string) ?? null,
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
  stats.templates = tplCount;
  stats.schedule_items = itemCount;

  // ---- 2. Schedules (configs x condition) -----------------------------------
  const insSched = db.prepare(`INSERT INTO vehicle_schedules
    (schedule_key, schedule_hash, year, make, model, trim, engine, engine_type, engine_size, engine_variant,
     drivetrain, transmission, driving_condition, schedule_name, source, last_updated)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  let schedCount = 0;
  db.exec("BEGIN");
  for await (const line of lines(join(dataDir, FILES.schedules))) {
    const o = JSON.parse(line) as { schedule_key: string; fields: Record<string, unknown> };
    const f = o.fields;
    try {
      const meta = parseDescriptionMeta(String(f["Description"]));
      if (meta.configKey !== o.schedule_key) {
        throw new Error(`Config Key mismatch: description=${meta.configKey} line=${o.schedule_key}`);
      }
      if (!templateHashes.has(meta.scheduleHash)) {
        throw new Error(`Schedule Hash not found in templates: ${meta.scheduleHash}`);
      }
      const eng = splitEngine(meta.engine);
      insSched.run(
        o.schedule_key, meta.scheduleHash,
        Number(f["Year"]), meta.make, String(f["Model"]), String(f["Trim"]),
        meta.engine, eng.engineType, eng.engineSize, eng.engineVariant,
        String(f["Drivetrain"]), meta.transmission, meta.drivingCondition,
        String(f["Schedule Name"]), meta.source, (f["Last Updated"] as string) ?? null,
      );
      schedCount++;
    } catch (e) {
      errors.push(`schedule ${o.schedule_key}: ${(e as Error).message}`);
      if (errors.length > 20) break;
    }
  }
  db.exec("COMMIT");
  stats.vehicle_schedules = schedCount;

  // ---- 3. Tasks --------------------------------------------------------------
  const insTask = db.prepare(`INSERT INTO tasks
    (task_key, task_name, interval_miles, category, priority, menu, service_id, use_count, raw_json)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  let taskCount = 0;
  db.exec("BEGIN");
  for await (const line of lines(join(dataDir, FILES.tasks))) {
    const o = JSON.parse(line) as { task_key: string; fields: Record<string, unknown>; source_item?: Record<string, unknown>; use_count?: number };
    const si = o.source_item ?? {};
    insTask.run(
      o.task_key,
      String(o.fields["Task Name"]),
      o.fields["Interval (Miles)"] != null ? Number(o.fields["Interval (Miles)"]) : null,
      (si["category"] as string) ?? null,
      (si["priority"] as string) ?? null,
      (si["menu"] as string) ?? null,
      si["service_id"] != null ? String(si["service_id"]) : null,
      o.use_count ?? null,
      line,
    );
    taskCount++;
  }
  db.exec("COMMIT");
  stats.tasks = taskCount;

  // ---- 4. Edges (Airtable link audit) ----------------------------------------
  if (!args.skipEdges && existsSync(join(dataDir, FILES.edges))) {
    const insEdge = db.prepare("INSERT OR IGNORE INTO schedule_task_edges (schedule_key, task_key) VALUES (?,?)");
    let edgeCount = 0;
    db.exec("BEGIN");
    for await (const line of lines(join(dataDir, FILES.edges))) {
      const o = JSON.parse(line) as { schedule_key: string; task_key: string };
      insEdge.run(o.schedule_key, o.task_key);
      edgeCount++;
      if (edgeCount % 500000 === 0) { db.exec("COMMIT"); db.exec("BEGIN"); }
    }
    db.exec("COMMIT");
    stats.schedule_task_edges = edgeCount;
  }

  // ---- 5. Airtable provenance -------------------------------------------------
  const insProv = db.prepare(`INSERT OR REPLACE INTO schedule_provenance
    (schedule_key, airtable_record_id, airtable_created_at, import_line_no) VALUES (?,?,?,?)`);
  let provCount = 0;
  db.exec("BEGIN");
  for await (const line of lines(join(dataDir, FILES.createSuccess))) {
    const o = JSON.parse(line) as { schedule_key: string; record_id?: string; created_at?: string; line_no?: number };
    insProv.run(o.schedule_key, o.record_id ?? null, o.created_at ?? null, o.line_no ?? null);
    provCount++;
  }
  db.exec("COMMIT");
  stats.schedule_provenance = provCount;

  // ---- 6. Import metadata ------------------------------------------------------
  const insMeta = db.prepare("INSERT OR REPLACE INTO import_meta (key, value) VALUES (?,?)");
  insMeta.run("built_at", new Date().toISOString());
  insMeta.run("etl_version", "0.1.0");
  insMeta.run("data_dir", dataDir);
  for (const [label, file] of Object.entries(FILES)) {
    const p = join(dataDir, file);
    if (existsSync(p)) insMeta.run(`source_sha256:${file}`, sha256File(p));
  }
  for (const [k, v] of Object.entries(stats)) insMeta.run(`rows:${k}`, String(v));

  if (errors.length > 0) {
    console.error(`FAIL-CLOSED: ${errors.length} integrity error(s):`);
    for (const e of errors) console.error("  " + e);
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(outPath + suffix, { force: true });
    process.exit(1);
  }

  db.pragma("journal_mode = WAL");
  db.pragma("optimize");
  db.close();

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`OK  ${outPath}  (${secs}s)`);
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(22)} ${v}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
