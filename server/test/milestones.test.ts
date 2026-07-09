import { describe, it, expect } from "vitest";
import { snapToGrid, nextMilestone, cycleMileage, buildContext, monthsToNext, nearbyMilestones } from "../src/milestones.js";

// 2020 4Runner grid: 5,000 .. 120,000 step 5,000
const GRID = Array.from({ length: 24 }, (_, i) => (i + 1) * 5000);

describe("snapToGrid (interval rounding, DoD #7)", () => {
  it("snaps exact milestones to themselves", () => {
    expect(snapToGrid(70_000, GRID)).toBe(70_000);
  });
  it("rounds up past the midpoint", () => {
    expect(snapToGrid(68_500, GRID)).toBe(70_000);
    expect(snapToGrid(72_600, GRID)).toBe(75_000);
  });
  it("rounds down before the midpoint", () => {
    expect(snapToGrid(71_900, GRID)).toBe(70_000);
    expect(snapToGrid(67_400, GRID)).toBe(65_000);
  });
  it("exact midpoint ties round UP (advisor sells the upcoming service)", () => {
    expect(snapToGrid(72_500, GRID)).toBe(75_000);
    expect(snapToGrid(67_500, GRID)).toBe(70_000);
  });
  it("clamps below the first milestone", () => {
    expect(snapToGrid(1_200, GRID)).toBe(5_000);
  });
});

describe("nextMilestone", () => {
  it("returns the first strictly greater grid point", () => {
    expect(nextMilestone(70_000, GRID)).toEqual({ milestone: 75_000, wraps: false });
    expect(nextMilestone(70_001, GRID)).toEqual({ milestone: 75_000, wraps: false });
    expect(nextMilestone(69_999, GRID)).toEqual({ milestone: 70_000, wraps: false });
  });
  it("wraps past the end of the grid", () => {
    expect(nextMilestone(120_000, GRID)).toEqual({ milestone: 5_000, wraps: true });
  });
});

describe("cycleMileage (beyond-grid extrapolation)", () => {
  it("passes through in-grid values", () => {
    expect(cycleMileage(70_000, 120_000)).toEqual({ value: 70_000, extrapolated: false });
    expect(cycleMileage(120_000, 120_000)).toEqual({ value: 120_000, extrapolated: false });
  });
  it("maps 125k on a 120k grid to the 5k pattern, flagged", () => {
    expect(cycleMileage(125_000, 120_000)).toEqual({ value: 5_000, extrapolated: true });
    expect(cycleMileage(240_000, 120_000)).toEqual({ value: 120_000, extrapolated: true });
    expect(cycleMileage(190_000, 120_000)).toEqual({ value: 70_000, extrapolated: true });
  });
});

describe("buildContext", () => {
  it("70,000 exact: due at 70k, next 75k, 5k away", () => {
    const c = buildContext(70_000, GRID, 5000);
    expect(c.snapped).toBe(70_000);
    expect(c.next).toBe(75_000);
    expect(c.milesToNext).toBe(5_000);
    expect(c.extrapolated).toBe(false);
  });
  it("68,500: snapped 70k but next is still 70k (hasn't passed it yet)", () => {
    const c = buildContext(68_500, GRID, 5000);
    expect(c.snapped).toBe(70_000);
    expect(c.next).toBe(70_000);
    expect(c.milesToNext).toBe(1_500);
  });
  it("190,000 on a 120k grid behaves like 70,000, flagged extrapolated", () => {
    const c = buildContext(190_000, GRID, 5000);
    expect(c.cycleMileage).toBe(70_000);
    expect(c.snapped).toBe(70_000);
    expect(c.extrapolated).toBe(true);
  });
});

describe("monthsToNext + nearbyMilestones", () => {
  it("ceil of miles/monthly", () => {
    expect(monthsToNext(5_000, 1_200)).toBe(5);
    expect(monthsToNext(1_500, 1_500)).toBe(1);
    expect(monthsToNext(5_000, null)).toBeNull();
    expect(monthsToNext(5_000, 0)).toBeNull();
  });
  it("windows around the snapped milestone", () => {
    expect(nearbyMilestones(70_000, GRID, 2, 2)).toEqual([60_000, 65_000, 70_000, 75_000, 80_000]);
    expect(nearbyMilestones(5_000, GRID, 2, 2)).toEqual([5_000, 10_000, 15_000]);
    expect(nearbyMilestones(120_000, GRID, 2, 2)).toEqual([110_000, 115_000, 120_000]);
  });
});
