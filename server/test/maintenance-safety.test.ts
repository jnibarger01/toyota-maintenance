import { describe, expect, it, vi } from "vitest";
import type { Lookup, ConfigRow, TaskIntervalRow } from "../src/queries.js";
import {
  conditionDelta,
  customerSafeTasks,
  resolveConfig,
  runMaintenanceLookup,
  type LookupResult,
  type MaintenanceLookupInput,
} from "../src/maintenance.js";
import { buildMaintenanceGrid } from "../src/grid.js";

const vehicle: ConfigRow = {
  config_key: "config-normal",
  schedule_hash: "hash-normal",
  year: 2020,
  make: "TOYOTA",
  model: "4RUNNER",
  trim: "SR5",
  engine: "V6 4.0L",
  engine_type: "V6",
  engine_size: "4.0L",
  engine_variant: null,
  drivetrain: "4WD",
  transmission: "Automatic",
  driving_condition: "Normal",
  schedule_name: "fixture",
  source: "Xtime",
};

const input: MaintenanceLookupInput = {
  year: 2020,
  model: "4RUNNER",
  trim: "SR5",
  engine: "V6",
  engineSize: "4.0L",
  drivetrain: "4WD",
  transmission: "Automatic",
  drivingCondition: "Normal",
  currentMileage: 10_000,
  overdueThresholdMiles: 1_000,
};

const task = (name: string, interval: number, customerVisible: number | null): TaskIntervalRow => ({
  task_key: `${name}-${interval}`,
  task_name: name,
  description: null,
  category: "Inspection",
  priority: "Recommended",
  menu: "Normal",
  service_id: null,
  interval_miles: interval,
  menu_price_cents: null,
  advisor_label: null,
  op_code: null,
  labor_hours: null,
  display_category: null,
  customer_visible: customerVisible,
});

describe("customer maintenance safety", () => {
  it("rejects multiple exact configuration matches on the strict customer path", () => {
    const lookup = {
      resolveBestConfig: vi.fn(() => ({ row: vehicle, matched_configs: 2, relaxed_fields: [] })),
    } as unknown as Lookup;

    expect(resolveConfig(lookup, input)).toBeNull();
    expect(resolveConfig(lookup, { ...input, allowRelaxedLookup: true })?.matched_configs).toBe(2);
  });

  it("derives lookup mileage context after hidden tasks are removed", () => {
    const tasks = [
      task("Visible 5k", 5_000, null),
      task("Hidden 10k", 10_000, 0),
      task("Visible 15k", 15_000, null),
    ];
    const lookup = {
      resolveBestConfig: vi.fn(() => ({ row: vehicle, matched_configs: 1, relaxed_fields: [] })),
      taskIntervals: vi.fn(() => tasks),
    } as unknown as Lookup;

    const result = runMaintenanceLookup(lookup, input, customerSafeTasks);
    expect(result?.intervals).toEqual([5_000, 15_000]);
    expect(result?.mileage.current_interval).toBe(5_000);
    expect(result?.mileage.next_interval).toBe(15_000);
    expect(result?.due_now.map((row) => row.task_name)).toEqual(["Visible 5k"]);

    const grid = buildMaintenanceGrid(customerSafeTasks(tasks), input.currentMileage);
    expect(grid.columns.find((column) => column.current)?.mileage).toBe(result?.mileage.current_interval);
  });

  it("does not compare driving conditions through a relaxed sibling configuration", () => {
    const result = {
      vehicle,
      resolution: { matched_configs: 1, relaxed_fields: [] },
      source: { config_key: vehicle.config_key, schedule_hash: vehicle.schedule_hash, source: "Xtime", schedule_name: "fixture" },
      intervals: [10_000],
      mileage: { current: 10_000, current_interval: 10_000, previous_interval: null, next_interval: null, overdue_threshold_miles: 1_000 },
      due_now: [],
      overdue: [],
      upcoming: [],
      estimate: { avg_monthly_mileage: null, months_to_next: null, next_due_date: null },
    } satisfies LookupResult;
    const lookup = {
      resolveBestConfig: vi.fn(() => ({
        row: { ...vehicle, config_key: "different-trim", trim: "Limited", driving_condition: "Severe" },
        matched_configs: 1,
        relaxed_fields: ["trim"],
      })),
      taskIntervals: vi.fn(() => []),
    } as unknown as Lookup;

    expect(conditionDelta(lookup, input, result)).toBeNull();
    expect(lookup.taskIntervals).not.toHaveBeenCalled();
  });
});
