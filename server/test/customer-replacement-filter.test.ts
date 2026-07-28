import { describe, expect, it } from "vitest";
import { customerSafeTasks } from "../src/maintenance.js";
import type { TaskIntervalRow } from "../src/queries.js";

function task(task_name: string, overrides: Partial<TaskIntervalRow> = {}): TaskIntervalRow {
  return {
    task_key: task_name.toLowerCase().replaceAll(" ", "-"),
    task_name,
    description: null,
    category: "Test",
    priority: null,
    menu: null,
    service_id: null,
    interval_miles: 30_000,
    menu_price_cents: 12_345,
    advisor_label: null,
    op_code: "TEST",
    labor_hours: 1,
    display_category: null,
    customer_visible: null,
    ...overrides,
  };
}

describe("customer replacement-only filter", () => {
  it("keeps only source tasks whose action is Replace", () => {
    const result = customerSafeTasks([
      task("Replace engine air filter"),
      task("Inspect engine air filter"),
      task("Visually inspect brake linings/drums and brake pads/discs"),
      task("Rotate tires"),
      task("Clean HV battery cooling intake filter"),
      task("Check installation of driver's floor mat"),
    ]);

    expect(result.map((item) => item.task_name)).toEqual(["Replace engine air filter"]);
  });

  it("remains case-insensitive, honors hidden mappings, and strips internal fields", () => {
    const result = customerSafeTasks([
      task("  rEpLaCe engine coolant"),
      task("Replace spark plugs", { customer_visible: 0 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      task_name: "  rEpLaCe engine coolant",
      menu_price_cents: null,
      op_code: null,
      labor_hours: null,
      customer_visible: null,
    });
  });
});
