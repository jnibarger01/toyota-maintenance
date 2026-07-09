/** sync:airtable --verify — health checks, strictly read-only. */
import type Database from "better-sqlite3";

export interface VerifyReport {
  healthy: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function runVerify(db: Database.Database): VerifyReport {
  const checks: VerifyReport["checks"] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const hasSched = tableExists(db, "maintenance_schedules");
  const hasLog = tableExists(db, "airtable_sync_log");
  add("sync tables present", hasSched && hasLog,
    hasSched && hasLog ? "maintenance_schedules + airtable_sync_log exist" : "missing — run sync:airtable --apply once");

  if (hasSched) {
    const total = (db.prepare("SELECT COUNT(*) AS n FROM maintenance_schedules").get() as { n: number }).n;
    add("mirror populated", total > 0, `${total} schedule rows`);

    const badKey = (db.prepare(
      "SELECT COUNT(*) AS n FROM maintenance_schedules WHERE schedule_key NOT GLOB '[0-9a-f]*' OR LENGTH(schedule_key) <> 40"
    ).get() as { n: number }).n;
    add("schedule_key format", badKey === 0, badKey === 0 ? "all keys are 40-hex" : `${badKey} malformed keys`);

    const noRef = (db.prepare(
      "SELECT COUNT(*) AS n FROM maintenance_schedules WHERE airtable_record_id IS NULL OR airtable_record_id = ''"
    ).get() as { n: number }).n;
    add("airtable record refs", noRef === 0, noRef === 0 ? "every row keeps its Airtable record_id" : `${noRef} rows missing record_id`);

    if (tableExists(db, "vehicle_configs")) {
      const matched = (db.prepare(
        "SELECT COUNT(*) AS n FROM maintenance_schedules m WHERE EXISTS (SELECT 1 FROM vehicle_configs v WHERE v.config_key = m.schedule_key)"
      ).get() as { n: number }).n;
      add("lookup cross-reference", true, `${matched}/${total} mirror keys match artifact vehicle_configs (informational)`);
    }
  }

  if (hasLog) {
    const last = db.prepare(
      "SELECT mode, status, finished_at FROM airtable_sync_log WHERE mode='apply' ORDER BY id DESC LIMIT 1"
    ).get() as { mode: string; status: string; finished_at: string } | undefined;
    add("last apply run", last ? last.status !== "failed" : false,
      last ? `status=${last.status} finished_at=${last.finished_at}` : "no apply run recorded yet");
  }

  return { healthy: checks.every((c) => c.ok || c.name === "lookup cross-reference"), checks };
}
