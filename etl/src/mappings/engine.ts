/**
 * Service task mapping engine.
 *
 * Maps raw Toyota/Xtime service names to advisor-friendly labels, categories,
 * op codes, labor hours, and menu prices — in the dealership-owned
 * service_task_mappings table ONLY. Raw source tables are never touched:
 * mapping is an overlay, and unknown tasks fall back to the raw name at
 * display time (already enforced in server/grid/guide).
 *
 * Two sources, one engine:
 *   - a JSON seed file (committed template ships without prices)
 *   - the airtable_service_mappings_raw mirror written by sync:airtable
 */
import type Database from "better-sqlite3";

export interface MappingRow {
  source_task_name: string;
  advisor_label: string | null;
  display_category: string | null;
  op_code: string | null;
  labor_hours: number | null;
  menu_price_cents: number | null;
  is_customer_visible: 0 | 1;
  advisor_note: string | null;
}

export interface MappingReport {
  mode: "dry-run" | "apply";
  source: string;
  rows_seen: number;
  inserted: number;
  updated: number;
  rejected: number;
  warnings: string[];
  errors: string[];
}

function asIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN as unknown as number;
}

/** Validate one candidate row; returns a MappingRow or an error string. */
export function validateRow(raw: Record<string, unknown>): MappingRow | string {
  const name = raw["source_task_name"];
  if (typeof name !== "string" || name.trim() === "") return "source_task_name is required";

  const price = asIntOrNull(raw["menu_price_cents"]);
  if (Number.isNaN(price) || (price !== null && price < 0)) {
    return `"${name}": menu_price_cents must be a non-negative integer (cents) or null`;
  }
  let labor: number | null = null;
  if (raw["labor_hours"] !== null && raw["labor_hours"] !== undefined && raw["labor_hours"] !== "") {
    labor = Number(raw["labor_hours"]);
    if (!Number.isFinite(labor) || labor < 0) return `"${name}": labor_hours must be a non-negative number or null`;
  }
  const visRaw = raw["is_customer_visible"];
  const visible: 0 | 1 =
    visRaw === 0 || visRaw === false ? 0 : 1; // default visible

  const str = (k: string) => (typeof raw[k] === "string" && (raw[k] as string).trim() !== "" ? (raw[k] as string).trim() : null);
  return {
    source_task_name: name.trim(),
    advisor_label: str("advisor_label"),
    display_category: str("display_category"),
    op_code: str("op_code"),
    labor_hours: labor,
    menu_price_cents: price,
    is_customer_visible: visible,
    advisor_note: str("advisor_note"),
  };
}

/** Airtable mirror fields -> MappingRow candidates (Title Case or snake_case). */
export function fromAirtableMirror(db: Database.Database): Array<Record<string, unknown>> {
  const rows = db.prepare("SELECT airtable_record_id, fields_json FROM airtable_service_mappings_raw").all() as
    Array<{ airtable_record_id: string; fields_json: string }>;
  return rows.map((r) => {
    const f = JSON.parse(r.fields_json) as Record<string, unknown>;
    const pick = (...keys: string[]) => keys.map((k) => f[k]).find((v) => v !== undefined && v !== null);
    // "Menu Price" in dollars is accepted and converted; "Menu Price Cents" wins when present.
    const cents = pick("Menu Price Cents", "menu_price_cents");
    const dollars = pick("Menu Price", "menu_price");
    return {
      source_task_name: pick("Source Task Name", "source_task_name"),
      advisor_label: pick("Advisor Label", "advisor_label"),
      display_category: pick("Display Category", "display_category"),
      op_code: pick("Op Code", "op_code"),
      labor_hours: pick("Labor Hours", "labor_hours"),
      menu_price_cents: cents ?? (typeof dollars === "number" ? Math.round(dollars * 100) : null),
      is_customer_visible: pick("Customer Visible", "is_customer_visible"),
      advisor_note: pick("Advisor Note", "advisor_note"),
      _airtable_record_id: r.airtable_record_id,
    };
  });
}

export function applyMappings(opts: {
  db: Database.Database;
  candidates: Array<Record<string, unknown>>;
  mode: "dry-run" | "apply";
  source: string;
  now?: () => Date;
}): MappingReport {
  const { db, candidates, mode, source } = opts;
  const now = opts.now ?? (() => new Date());
  const report: MappingReport = {
    mode, source, rows_seen: candidates.length,
    inserted: 0, updated: 0, rejected: 0, warnings: [], errors: [],
  };

  const taskExists = db.prepare("SELECT 1 FROM maintenance_tasks WHERE task_name = ? LIMIT 1");
  const findFirst = db.prepare("SELECT id FROM service_task_mappings WHERE source_task_name = ? ORDER BY id LIMIT 1");

  const valid: Array<{ row: MappingRow; existingId: number | null }> = [];
  const plannedNames = new Set<string>();
  for (const c of candidates) {
    const v = validateRow(c);
    if (typeof v === "string") {
      report.rejected++;
      report.errors.push(v + (c["_airtable_record_id"] ? ` (airtable ${c["_airtable_record_id"]})` : ""));
      continue;
    }
    if (!taskExists.get(v.source_task_name)) {
      report.warnings.push(`"${v.source_task_name}" does not match any known Xtime task name — applied anyway (may match a future data drop)`);
    }
    const existing = findFirst.get(v.source_task_name) as { id: number } | undefined;
    const isUpdate = !!existing || plannedNames.has(v.source_task_name);
    plannedNames.add(v.source_task_name);
    if (isUpdate) report.updated++; else report.inserted++;
    valid.push({ row: v, existingId: existing?.id ?? null });
  }

  if (mode === "dry-run") return report; // validated + reported, wrote nothing

  const iso = now().toISOString();
  const insert = db.prepare(`
    INSERT INTO service_task_mappings
      (source_task_name, advisor_label, display_category, op_code, labor_hours,
       menu_price_cents, is_customer_visible, advisor_note, created_at, updated_at)
    VALUES (@source_task_name, @advisor_label, @display_category, @op_code, @labor_hours,
            @menu_price_cents, @is_customer_visible, @advisor_note, @created_at, @updated_at)
  `);
  const update = db.prepare(`
    UPDATE service_task_mappings SET
      advisor_label = @advisor_label, display_category = @display_category, op_code = @op_code,
      labor_hours = @labor_hours, menu_price_cents = @menu_price_cents,
      is_customer_visible = @is_customer_visible, advisor_note = @advisor_note, updated_at = @updated_at
    WHERE id = @id
  `);

  db.transaction(() => {
    for (const { row, existingId } of valid) {
      // Re-resolve: an earlier row in this batch may have inserted this name.
      const target = existingId ?? (findFirst.get(row.source_task_name) as { id: number } | undefined)?.id ?? null;
      if (target !== null) update.run({ ...row, id: target, updated_at: iso });
      else insert.run({ ...row, created_at: iso, updated_at: iso });
    }
  })();

  return report;
}
