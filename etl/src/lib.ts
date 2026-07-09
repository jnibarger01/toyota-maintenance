/**
 * Pure parsing helpers for the ETL. No I/O here — unit-testable.
 */

export interface DescriptionMeta {
  source: string;
  configKey: string;
  scheduleHash: string;
  make: string;
  engine: string;
  transmission: string;
  drivingCondition: string;
}

const DESC_LINE = /^(Source|Config Key|Schedule Hash|Make|Engine|Transmission|Driving Condition):\s*(.*)$/gm;

/** Parse the labeled metadata lines embedded in the Airtable Description field. Fail-closed: throws on any missing field. */
export function parseDescriptionMeta(description: string): DescriptionMeta {
  const map = new Map<string, string>();
  for (const m of description.matchAll(DESC_LINE)) map.set(m[1], m[2].trim());
  const req = (k: string): string => {
    const v = map.get(k);
    if (v === undefined || v === "") throw new Error(`Description missing required field: ${k}`);
    return v;
  };
  return {
    source: req("Source"),
    configKey: req("Config Key"),
    scheduleHash: req("Schedule Hash"),
    make: req("Make"),
    engine: req("Engine"),
    transmission: req("Transmission"),
    drivingCondition: req("Driving Condition"),
  };
}

export interface EngineParts {
  engineType: string;    // V6, I4, H4, I6, I3, V8, Electric
  engineSize: string;    // 4.0L, 0.0L
  engineVariant: string | null; // Turbo, FFV
}

const ENGINE_RE = /^([A-Za-z]+\d*|Electric)\s+(\d+(?:\.\d+)?L)(?:\s*-\s*(.+))?$/;

/** Split 'V6 4.0L', 'I4 2.4L - Turbo', 'Electric 0.0L' into parts. Fail-closed on unknown shapes. */
export function splitEngine(engine: string): EngineParts {
  const m = ENGINE_RE.exec(engine.trim());
  if (!m) throw new Error(`Unparseable engine string: ${JSON.stringify(engine)}`);
  return { engineType: m[1], engineSize: m[2], engineVariant: m[3]?.trim() ?? null };
}

export interface ScheduleItem {
  mileage: number;
  months: number | null;
  menu: string;
  service_id: string | null;
  service_name: string;
  description: string | null;
  category: string | null;
  priority: string | null;
  order: number | null;
}

/** Grid stats from a template's items: sorted distinct mileages, min/max, min consecutive step.
 *  Empty item lists are legitimate upstream data (e.g. EV configs, source gaps) -> zeroed grid. */
export function gridStats(items: ScheduleItem[]): { grid: number[]; min: number; max: number; step: number } {
  const set = new Set<number>();
  for (const it of items) {
    if (!Number.isInteger(it.mileage) || it.mileage <= 0) {
      throw new Error(`Invalid item mileage: ${JSON.stringify(it.mileage)}`);
    }
    set.add(it.mileage);
  }
  const grid = [...set].sort((a, b) => a - b);
  if (grid.length === 0) return { grid, min: 0, max: 0, step: 0 };
  let step = grid.length > 1 ? Infinity : grid[0];
  for (let i = 1; i < grid.length; i++) step = Math.min(step, grid[i] - grid[i - 1]);
  return { grid, min: grid[0], max: grid[grid.length - 1], step };
}
