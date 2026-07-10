import { describe, expect, it } from "vitest";
import {
  MAX_SUPPORTED_YEAR,
  MIN_SUPPORTED_YEAR,
  VehicleCatalogBuilder,
  modelSlug,
  normalizeVehicleSourceRow,
} from "../src/vehicle-catalog.js";

const CONFIG_KEY = "1".repeat(40);
const SCHEDULE_HASH = "a".repeat(64);

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const schedule = JSON.stringify([{ mileage: 5_000 }]);
  const scheduleText = "5,000 miles";
  return {
    "Config Key": CONFIG_KEY,
    "Year": 2020,
    "Make": "TOYOTA",
    "Model": "4RUNNER",
    "Trim": "Limited",
    "Engine Type": "V6",
    "Engine Size": "4.0L",
    "Engine": "V6 4.0L",
    "Drivetrain": "4WD",
    "Transmission": "Automatic",
    "Driving Condition": "Normal",
    "Schedule Hash": SCHEDULE_HASH,
    "Mileage Point Count": 1,
    "Service Item Count": 1,
    "Schedule Text Chars": Array.from(scheduleText).length,
    "Schedule JSON Chars": Array.from(schedule).length,
    "Schedule JSON": schedule,
    "Schedule Text": scheduleText,
    "Source": "Xtime",
    ...overrides,
  };
}

function sourceFacts() {
  return { sourceFile: "sample.jsonl", sourceSha256: "f".repeat(64), sourceBytes: 123 };
}

function indexedHex(value: number, length: number): string {
  return value.toString(16).padStart(length, "0");
}

describe("vehicle source row normalization", () => {
  it("normalizes an exact valid source row into customer-safe option metadata", () => {
    const result = normalizeVehicleSourceRow(makeRow(), 1);
    expect(result.issues).toEqual([]);
    expect(result.record).toMatchObject({
      configId: CONFIG_KEY,
      scheduleKey: CONFIG_KEY,
      year: 2020,
      model: "4RUNNER",
      modelSlug: "4runner",
      engineType: "V6",
      engineSize: "4.0L",
      engineVariant: null,
      condition: "Normal",
      emptySchedule: false,
    });
    expect(result.record?.configurationGroupId).toMatch(/^[a-f0-9]{40}$/);
  });

  it("rejects missing, extra, and incorrectly typed fields", () => {
    const row = makeRow({ Unexpected: true, Year: "2020" });
    delete row.Trim;
    const result = normalizeVehicleSourceRow(row, 7);
    expect(result.record).toBeUndefined();
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MISSING_FIELD", field: "Trim", line: 7 }),
      expect.objectContaining({ code: "UNEXPECTED_FIELD", line: 7 }),
      expect.objectContaining({ code: "INVALID_TYPE", field: "Year", line: 7 }),
    ]));
  });

  it("rejects years outside the inclusive 2000-2026 contract", () => {
    expect(normalizeVehicleSourceRow(makeRow({ Year: 1999 }), 1).issues)
      .toContainEqual(expect.objectContaining({ code: "INVALID_YEAR" }));
    expect(normalizeVehicleSourceRow(makeRow({ Year: 2027 }), 1).issues)
      .toContainEqual(expect.objectContaining({ code: "INVALID_YEAR" }));
    expect(normalizeVehicleSourceRow(makeRow({ Year: 2000 }), 1).record?.year).toBe(2000);
    expect(normalizeVehicleSourceRow(makeRow({ Year: 2026 }), 1).record?.year).toBe(2026);
  });

  it("validates configuration key and schedule hash shapes", () => {
    const result = normalizeVehicleSourceRow(makeRow({
      "Config Key": "not-a-key",
      "Schedule Hash": "NOT-A-HASH",
    }), 1);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_CONFIG_KEY" }),
      expect.objectContaining({ code: "INVALID_SCHEDULE_HASH" }),
    ]));
  });

  it("separates engine size and variant when the source size carries the variant", () => {
    const result = normalizeVehicleSourceRow(makeRow({
      "Engine Type": "V8",
      "Engine Size": "5.7L - FFV",
      "Engine": "V8 5.7L - FFV",
    }), 1);
    expect(result.record).toMatchObject({ engineSize: "5.7L", engineVariant: "FFV" });
    expect(result.issues).toEqual([]);
  });

  it("retains authentic empty schedules and reports them as warnings", () => {
    const result = normalizeVehicleSourceRow(makeRow({
      "Mileage Point Count": 0,
      "Service Item Count": 0,
      "Schedule Text Chars": 0,
      "Schedule JSON Chars": 2,
      "Schedule JSON": "[]",
      "Schedule Text": "",
    }), 1);
    expect(result.record?.emptySchedule).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "warning", code: "EMPTY_SCHEDULE" }));
  });
});

describe("VehicleCatalogBuilder integrity and coverage", () => {
  it("fails duplicate upstream keys and duplicate normalized condition tuples", () => {
    const builder = new VehicleCatalogBuilder();
    builder.add(makeRow(), 1);
    builder.add(makeRow(), 2);
    const { report } = builder.finish("sample", sourceFacts());
    expect(report.ok).toBe(false);
    expect(report.duplicateConfigKeys).toBe(1);
    expect(report.duplicateConfigurations).toBe(1);
  });

  it("detects a duplicate normalized tuple even when the upstream key differs", () => {
    const builder = new VehicleCatalogBuilder();
    builder.add(makeRow(), 1);
    builder.add(makeRow({ "Config Key": "2".repeat(40) }), 2);
    const { report } = builder.finish("sample", sourceFacts());
    expect(report.duplicateConfigKeys).toBe(0);
    expect(report.duplicateConfigurations).toBe(1);
  });

  it("reports missing or unindexed schedule mappings", () => {
    const missingHash = new VehicleCatalogBuilder();
    missingHash.add(makeRow({ "Schedule Hash": "" }), 1);
    const missingReport = missingHash.finish("sample", sourceFacts()).report;
    expect(missingReport.configurationsWithoutScheduleMapping).toBe(1);
    expect(missingReport.issues).toContainEqual(expect.objectContaining({ code: "MISSING_FIELD", field: "Schedule Hash" }));

    const absentFromIndex = new VehicleCatalogBuilder({ templateHashes: new Set(["b".repeat(64)]) });
    absentFromIndex.add(makeRow(), 1);
    const indexedReport = absentFromIndex.finish("sample", sourceFacts()).report;
    expect(indexedReport.configurationsWithoutScheduleMapping).toBe(1);
    expect(indexedReport.issues).toContainEqual(expect.objectContaining({ code: "UNMAPPED_SCHEDULE" }));
  });

  it("detects route-significant model slug collisions", () => {
    expect(modelSlug("RAV 4")).toBe("rav-4");
    expect(modelSlug("RAV-4")).toBe("rav-4");
    const builder = new VehicleCatalogBuilder();
    builder.add(makeRow({ Model: "RAV 4" }), 1);
    builder.add(makeRow({
      "Config Key": "2".repeat(40),
      "Schedule Hash": "b".repeat(64),
      Model: "RAV-4",
    }), 2);
    const { report } = builder.finish("sample", sourceFacts());
    expect(report.modelSlugCollisions).toBe(1);
    expect(report.ok).toBe(false);
  });

  it("allows incomplete sample coverage but fails the same gap in full mode", () => {
    const sample = new VehicleCatalogBuilder();
    sample.add(makeRow(), 1);
    const sampleResult = sample.finish("sample", sourceFacts());
    expect(sampleResult.report.ok).toBe(true);
    expect(sampleResult.report.coverageErrorCount).toBe(0);
    expect(sampleResult.report.missingYears).toContain(MIN_SUPPORTED_YEAR);
    expect(sampleResult.catalog?.metadata.coverage).toBe("partial");

    const full = new VehicleCatalogBuilder();
    full.add(makeRow(), 1);
    const fullResult = full.finish("full", sourceFacts());
    expect(fullResult.report.ok).toBe(false);
    expect(fullResult.report.coverageErrorCount).toBe(1);
    expect(fullResult.catalog).toBeUndefined();
  });

  it("accepts strict full coverage when every supported year is present", () => {
    const builder = new VehicleCatalogBuilder();
    let line = 0;
    for (let year = MIN_SUPPORTED_YEAR; year <= MAX_SUPPORTED_YEAR; year++) {
      line++;
      builder.add(makeRow({
        Year: year,
        "Config Key": indexedHex(line, 40),
        "Schedule Hash": indexedHex(line, 64),
      }), line);
    }
    const result = builder.finish("full", sourceFacts());
    expect(result.report.ok).toBe(true);
    expect(result.report.missingYears).toEqual([]);
    expect(result.catalog?.metadata.sourceYearRange).toEqual({ min: MIN_SUPPORTED_YEAR, max: MAX_SUPPORTED_YEAR });
  });

  it("emits a compact catalog shape without raw schedule bodies or task edges", () => {
    const builder = new VehicleCatalogBuilder({ templateHashes: new Set([SCHEDULE_HASH]) });
    builder.add(makeRow(), 1);
    builder.add(makeRow({
      "Config Key": "2".repeat(40),
      "Driving Condition": "Severe",
    }), 2);
    const result = builder.finish("sample", sourceFacts());
    expect(result.report.ok).toBe(true);
    expect(result.report.emptySchedules).toBe(0);
    expect(result.catalog).toMatchObject({
      metadata: {
        schemaVersion: 1,
        sourceRows: 2,
        supportedYearRange: { min: 2000, max: MAX_SUPPORTED_YEAR },
        scheduleMappingValidation: "template-index",
      },
      summary: {
        totalYears: 1,
        totalModels: 1,
        totalConfigurations: 2,
        totalPhysicalConfigurations: 1,
      },
    });
    expect(result.catalog?.models[0]).toMatchObject({
      modelSlug: "4runner",
      configurationCount: 2,
      physicalConfigurationCount: 1,
      conditions: ["Normal", "Severe"],
    });
    expect(result.catalog?.configurations).toHaveLength(2);
    const serialized = JSON.stringify(result.catalog);
    expect(serialized).not.toContain("Schedule JSON");
    expect(serialized).not.toContain("Schedule Text");
    expect(serialized).not.toContain("task_edges");
  });
});
