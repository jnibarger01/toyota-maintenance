import { describe, expect, it } from "vitest";
import { buildMaintenanceGrid } from "../src/grid.js";
import type { TaskIntervalRow } from "../src/queries.js";

function task(name: string, mileage: number): TaskIntervalRow {
  return {
    task_key: `${name}-${mileage}`,
    task_name: name,
    description: `${name} description`,
    category: "Inspection",
    priority: "Recommended",
    menu: "Normal",
    service_id: null,
    interval_miles: mileage,
    menu_price_cents: null,
    advisor_label: null,
    op_code: null,
    labor_hours: null,
    display_category: null,
    customer_visible: null,
  };
}

describe("buildMaintenanceGrid full timeline", () => {
  it("keeps the nearby compatibility window unchanged", () => {
    const tasks = [5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000]
      .map((mileage) => task("Inspect vehicle", mileage));

    const grid = buildMaintenanceGrid(tasks, 20_000);

    expect(grid.columns.map((column) => column.mileage)).toEqual([
      10_000, 15_000, 20_000, 25_000, 30_000, 35_000,
    ]);
  });

  it("adds a 0-120k axis, retains real non-5k intervals, and exposes all in-range details", () => {
    const tasks = [
      task("Inspect vehicle", 7_500),
      task("Inspect vehicle", 15_000),
      task("Inspect vehicle", 125_000),
      task("Replace oil", 110_000),
    ];

    const grid = buildMaintenanceGrid(tasks, 12_000, {
      range: "full",
      minMileage: 0,
      maxMileage: 120_000,
    });

    expect(grid.columns[0].mileage).toBe(0);
    expect(grid.columns.at(-1)?.mileage).toBe(120_000);
    expect(grid.columns.map((column) => column.mileage)).toContain(7_500);
    for (let mileage = 0; mileage <= 120_000; mileage += 5_000) {
      expect(grid.columns.map((column) => column.mileage)).toContain(mileage);
    }
    expect(grid.currentInterval).toBe(7_500);
    expect(grid.nextInterval).toBe(15_000);
    expect(grid.columns.find((column) => column.current)?.mileage).toBe(7_500);
    expect(grid.columns.find((column) => column.next)?.mileage).toBe(15_000);

    const inspection = grid.rows.find((row) => row.taskName === "Inspect vehicle");
    expect(inspection?.details.map((detail) => detail.mileage)).toEqual([7_500, 15_000]);
    expect(inspection?.cells["7500"]).toBe(true);
    expect(inspection?.cells["10000"]).toBe(false);
    expect(inspection?.details.some((detail) => detail.mileage === 125_000)).toBe(false);
  });

  it("extends the default full range through the final published interval", () => {
    const grid = buildMaintenanceGrid([task("Inspect vehicle", 125_000)], 70_000, { range: "full" });

    expect(grid.columns[0].mileage).toBe(0);
    expect(grid.columns.at(-1)?.mileage).toBe(125_000);
    expect(grid.nextInterval).toBe(125_000);
    expect(grid.columns.find((column) => column.next)?.mileage).toBe(125_000);
  });

  it("returns a navigable empty axis without inventing tasks or intervals", () => {
    const grid = buildMaintenanceGrid([], 70_000, {
      range: "full",
      minMileage: 0,
      maxMileage: 120_000,
    });

    expect(grid.columns.map((column) => column.mileage)).toEqual(
      Array.from({ length: 25 }, (_, index) => index * 5_000),
    );
    expect(grid.rows).toEqual([]);
    expect(grid.currentInterval).toBeNull();
    expect(grid.nextInterval).toBeNull();
    expect(grid.columns.some((column) => column.current || column.next)).toBe(false);
  });
});
