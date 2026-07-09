import { describe, it, expect } from "vitest";
import { parseDescriptionMeta, splitEngine, gridStats } from "../src/lib.js";

describe("parseDescriptionMeta", () => {
  const desc = [
    "Source: Xtime",
    "Config Key: 317848a5f55d37ab8609e561e336899bc3bab32b",
    "Schedule Hash: 7d807a092e43da66315110c158d3251146bb38af51ae875c4ce0747933a34e21",
    "Make: TOYOTA",
    "Engine: V6 4.0L",
    "Transmission: Automatic",
    "Driving Condition: Normal",
    "Mileage Point Count: 24",
    "",
    "### 5,000 miles — Normal - Replace engine oil",
  ].join("\n");

  it("extracts all labeled fields", () => {
    const m = parseDescriptionMeta(desc);
    expect(m.configKey).toBe("317848a5f55d37ab8609e561e336899bc3bab32b");
    expect(m.scheduleHash).toMatch(/^7d807a09/);
    expect(m.make).toBe("TOYOTA");
    expect(m.engine).toBe("V6 4.0L");
    expect(m.transmission).toBe("Automatic");
    expect(m.drivingCondition).toBe("Normal");
  });

  it("fails closed when a required field is missing", () => {
    expect(() => parseDescriptionMeta("Source: Xtime\nMake: TOYOTA")).toThrow(/missing required field/);
  });
});

describe("splitEngine", () => {
  it("splits plain engines", () => {
    expect(splitEngine("V6 4.0L")).toEqual({ engineType: "V6", engineSize: "4.0L", engineVariant: null });
    expect(splitEngine("I4 2.5L")).toEqual({ engineType: "I4", engineSize: "2.5L", engineVariant: null });
  });
  it("splits variants", () => {
    expect(splitEngine("I4 2.4L - Turbo")).toEqual({ engineType: "I4", engineSize: "2.4L", engineVariant: "Turbo" });
    expect(splitEngine("V8 5.7L - FFV")).toEqual({ engineType: "V8", engineSize: "5.7L", engineVariant: "FFV" });
    expect(splitEngine("Electric 0.0L")).toEqual({ engineType: "Electric", engineSize: "0.0L", engineVariant: null });
  });
  it("fails closed on garbage", () => {
    expect(() => splitEngine("banana")).toThrow(/Unparseable engine/);
  });
});

describe("gridStats", () => {
  const item = (mileage: number) => ({
    mileage, months: null, menu: "Normal", service_id: "1",
    service_name: "x", description: "", category: null, priority: null, order: 1,
  });
  it("computes sorted distinct grid with min step", () => {
    const g = gridStats([item(15000), item(5000), item(5000), item(10000)]);
    expect(g.grid).toEqual([5000, 10000, 15000]);
    expect(g.min).toBe(5000);
    expect(g.max).toBe(15000);
    expect(g.step).toBe(5000);
  });
  it("rejects invalid mileages", () => {
    expect(() => gridStats([item(0)])).toThrow();
  });
  it("empty templates are legitimate: zeroed grid, no throw", () => {
    expect(gridStats([])).toEqual({ grid: [], min: 0, max: 0, step: 0 });
  });
});
