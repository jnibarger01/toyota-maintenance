/** Deterministic API fixtures mirroring the real server response shapes. */
import type {
  ConfigRecord, GridResponse, GuideResponse, LookupResult, LookupTask, OptionsResponse, Source, Vehicle,
} from "../src/api";

export const CONFIG_KEY = "317848a5f55d37ab8609e561e336899bc3bab32b";
export const HASH = "7d807a092e43da66315110c158d3251146bb38af51ae875c4ce0747933a34e21";

export const vehicle: Vehicle = {
  config_key: CONFIG_KEY, schedule_hash: HASH,
  year: 2020, make: "TOYOTA", model: "4RUNNER", trim: "SR5",
  engine: "V6 4.0L", engine_type: "V6", engine_size: "4.0L",
  drivetrain: "4WD", transmission: "Automatic", driving_condition: "Normal",
  schedule_name: "2020 TOYOTA 4RUNNER SR5 4WD V6 4.0L Automatic Normal", source: "Xtime",
};

export const source: Source = {
  config_key: CONFIG_KEY, schedule_hash: HASH, source: "Xtime", schedule_name: vehicle.schedule_name,
};

export const configRecord: ConfigRecord = {
  config_key: CONFIG_KEY,
  schedule_hash: HASH,
  year: vehicle.year,
  make: vehicle.make,
  model: vehicle.model,
  trim: vehicle.trim,
  engine: vehicle.engine,
  engine_type: vehicle.engine_type,
  engine_size: vehicle.engine_size,
  engine_variant: null,
  drivetrain: vehicle.drivetrain,
  transmission: vehicle.transmission,
  driving_condition: vehicle.driving_condition,
  schedule_name: vehicle.schedule_name,
  source: vehicle.source,
};

const task = (name: string, miles: number, extra: Partial<LookupTask> = {}): LookupTask => ({
  task_key: `${name}-${miles}`.replace(/\s+/g, "-").toLowerCase(),
  task_name: name, description: null, category: "Diagnostics & Inspection", priority: "Recommended", menu: "Normal",
  service_id: null, interval_miles: miles, menu_price_cents: null, advisor_label: null,
  op_code: null, labor_hours: null, display_category: null, customer_visible: null, ...extra,
});

export const dueTasks: LookupTask[] = [
  task("Replace engine oil and oil filter", 70000, { category: "Oil & Consumables" }),
  // Mapped item: advisor label + dealership op code/labor/price (internal-only fields).
  task("Rotate tires", 70000, {
    category: "Wheels & Tires", advisor_label: "TIRE ROT", op_code: "27T", labor_hours: 0.3, menu_price_cents: 2995,
  }),
  task("Hidden internal inspection", 70000, {
    advisor_label: "HIDDEN TASK", menu_price_cents: 9999, customer_visible: 0,
  }),
  task("Inspect and adjust all fluid levels", 70000),
  task("Inspect wiper blades", 70000),
  task("Visually inspect brake linings/drums and brake pads/discs", 70000, { category: "Brakes" }),
  task("Check installation of driver's floor mat", 70000),
  task("Reset oil replacement reminder light if equipped", 70000, { category: "Oil & Consumables" }),
];

export const lookupResult: LookupResult = {
  vehicle, source,
  resolution: { matched_configs: 1, relaxed_fields: [] },
  intervals: [60000, 65000, 70000, 75000, 80000, 85000],
  mileage: { current: 70000, current_interval: 70000, previous_interval: 65000, next_interval: 75000, overdue_threshold_miles: 1000 },
  due_now: dueTasks,
  overdue: [task("Inspect steering linkage and boots", 65000)],
  upcoming: [task("Replace spark plugs", 75000)],
  estimate: { avg_monthly_mileage: 833, months_to_next: 7, next_due_date: "2027-02-09" },
};

export const gridResponse: GridResponse = {
  vehicle, source,
  resolution: { matched_configs: 1, relaxed_fields: [] },
  mileage: { current: 70000, current_interval: 70000, next_interval: 75000 },
  columns: Array.from({ length: 25 }, (_, index) => {
    const mileage = index * 5000;
    return {
      mileage,
      label: mileage.toLocaleString("en-US"),
      ...(mileage === 70000 ? { current: true as const } : {}),
      ...(mileage === 75000 ? { next: true as const } : {}),
    };
  }),
  rows: [
    {
      taskName: "Replace engine oil and oil filter", category: "Oil & Consumables",
      advisor_label: null, advisor_rank: 1, description: "Imported source description for the oil service task.",
      cells: Object.fromEntries(Array.from({ length: 25 }, (_, index) => [String(index * 5000), index * 5000 === 70000])),
      details: [{ mileage: 70000, task_key: "oil-70000", service_id: null, priority: "Recommended", menu: "Normal", menu_price_cents: null, description: null }],
    },
    {
      taskName: "Rotate tires", category: "Wheels & Tires",
      advisor_label: "TIRE ROT", advisor_rank: 2, description: null,
      cells: Object.fromEntries(Array.from({ length: 25 }, (_, index) => [String(index * 5000), [65000, 70000, 75000].includes(index * 5000)])),
      details: [{ mileage: 70000, task_key: "rot-70000", service_id: null, priority: "Recommended", menu: "Normal", menu_price_cents: 2995, description: null }],
    },
  ],
};

export const guideResponse: GuideResponse = {
  vehicle, source,
  guide: {
    sections: [
      { id: "vehicle_summary", title: "Vehicle summary", paragraphs: ["2020 TOYOTA 4RUNNER SR5 — Normal driving schedule."] },
      { id: "due_now", title: "At this interval", paragraphs: ["At 70,000 miles, this schedule shows oil and filter service."],
        items: [{ label: "Rotate tires", tags: ["recommended"] }] },
      { id: "next_visit", title: "Next visit", paragraphs: ["The next maintenance point is 75,000 miles."] },
      { id: "internal_advisor_notes", title: "Internal advisor notes", internal: true,
        paragraphs: ["Rotate tires: op code 27T, 0.3 hr labor, menu $29.95."] },
    ],
  },
};

export const optionsResponse: OptionsResponse = {
  trims: ["Limited", "SR5", "TRD Pro"],
  engines: [{ engine: "V6 4.0L", engine_type: "V6", engine_size: "4.0L", engine_variant: null }],
  engine_types: ["V6"],
  engine_sizes: ["4.0L"],
  drivetrains: ["4WD", "RWD"],
  transmissions: ["Automatic"],
  driving_conditions: ["Normal", "Severe"],
};

/** Route-by-URL fetch mock; records calls for assertions. */
export function installFetchMock(vi: typeof import("vitest").vi) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const respond = (data: unknown) =>
    Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }));

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.startsWith("/api/years")) return respond({ years: [2026, 2020, 2001] });
    if (url.startsWith("/api/models")) return respond({ year: 2020, models: ["4RUNNER", "4RUNNER", "CAMRY", "TUNDRA"] });
    if (url.startsWith("/api/options")) return respond(optionsResponse);
    if (url === `/api/configs/${CONFIG_KEY}`) return respond(configRecord);
    if (url.startsWith("/api/configs?")) return respond({ count: 1, truncated: false, configs: [configRecord] });
    if (url.startsWith("/api/maintenance/lookup")) return respond(lookupResult);
    if (url.startsWith("/api/maintenance/grid")) return respond(gridResponse);
    if (url.startsWith("/api/maintenance/guide")) return respond(guideResponse);
    return Promise.resolve(new Response(JSON.stringify({ error: `unmocked ${url}` }), { status: 404 }));
  });

  return calls;
}
