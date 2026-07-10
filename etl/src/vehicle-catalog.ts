import { createHash } from "node:crypto";
import { splitEngine } from "./lib.js";

export const VEHICLE_CATALOG_SCHEMA_VERSION = 1;
export const MIN_SUPPORTED_YEAR = 2000;
export const MAX_SUPPORTED_YEAR = 2026;

export type CoverageMode = "sample" | "full";
export type ValidationSeverity = "error" | "warning";

export const SOURCE_FIELDS = [
  "Config Key",
  "Year",
  "Make",
  "Model",
  "Trim",
  "Engine Type",
  "Engine Size",
  "Engine",
  "Drivetrain",
  "Transmission",
  "Driving Condition",
  "Schedule Hash",
  "Mileage Point Count",
  "Service Item Count",
  "Schedule Text Chars",
  "Schedule JSON Chars",
  "Schedule JSON",
  "Schedule Text",
  "Source",
] as const;

type SourceField = (typeof SOURCE_FIELDS)[number];

export interface VehicleCatalogIssue {
  severity: ValidationSeverity;
  code:
    | "INVALID_ROW"
    | "MISSING_FIELD"
    | "UNEXPECTED_FIELD"
    | "INVALID_TYPE"
    | "INVALID_YEAR"
    | "INVALID_CONFIG_KEY"
    | "INVALID_SCHEDULE_HASH"
    | "INVALID_ENGINE"
    | "ENGINE_FIELD_MISMATCH"
    | "INVALID_SCHEDULE_JSON"
    | "INVALID_SCHEDULE_ITEM"
    | "SCHEDULE_COUNT_MISMATCH"
    | "CHAR_COUNT_MISMATCH"
    | "EMPTY_MODEL_SLUG"
    | "DUPLICATE_CONFIG_KEY"
    | "DUPLICATE_CONFIGURATION"
    | "MODEL_SLUG_COLLISION"
    | "UNMAPPED_SCHEDULE"
    | "EMPTY_SCHEDULE"
    | "MISSING_YEAR_COVERAGE"
    | "INVALID_JSON";
  line?: number;
  field?: SourceField;
  message: string;
}

export interface VehicleConfigurationOption {
  /** Stable upstream condition-specific identifier. */
  configId: string;
  scheduleKey: string;
  /** Stable grouping key shared by condition variants of one physical vehicle. */
  configurationGroupId: string;
  modelId: string;
  year: number;
  make: string;
  model: string;
  modelSlug: string;
  trim: string;
  engine: string;
  engineType: string;
  engineSize: string;
  engineVariant: string | null;
  transmission: string;
  drivetrain: string;
  condition: string;
  scheduleHash: string;
  mileagePointCount: number;
  serviceItemCount: number;
  emptySchedule: boolean;
  source: string;
}

export interface VehicleCatalogYearSummary {
  year: number;
  makeCount: number;
  modelCount: number;
  configurationCount: number;
  physicalConfigurationCount: number;
  emptyScheduleCount: number;
}

export interface VehicleCatalogModelSummary {
  id: string;
  year: number;
  make: string;
  model: string;
  modelSlug: string;
  displayName: string;
  configurationCount: number;
  physicalConfigurationCount: number;
  emptyScheduleCount: number;
  conditions: string[];
}

export interface VehicleCatalogSummary {
  totalYears: number;
  totalModels: number;
  distinctModelNames: number;
  totalConfigurations: number;
  totalPhysicalConfigurations: number;
  totalSchedules: number;
  emptySchedules: number;
  configurationsWithoutScheduleMapping: number;
  countsByYear: VehicleCatalogYearSummary[];
}

export interface VehicleCatalog {
  metadata: {
    schemaVersion: number;
    sourceFile: string;
    sourceSha256: string;
    sourceBytes: number;
    sourceRows: number;
    supportedYearRange: { min: number; max: number };
    sourceYearRange: { min: number | null; max: number | null };
    missingYears: number[];
    coverage: "complete" | "partial";
    scheduleMappingValidation: "embedded" | "template-index";
  };
  summary: VehicleCatalogSummary;
  years: VehicleCatalogYearSummary[];
  models: VehicleCatalogModelSummary[];
  configurations: VehicleConfigurationOption[];
}

export interface VehicleCatalogValidationReport {
  ok: boolean;
  mode: CoverageMode;
  sourceFile: string;
  sourceRows: number;
  validConfigurations: number;
  integrityErrorCount: number;
  warningCount: number;
  coverageErrorCount: number;
  missingYears: number[];
  duplicateConfigKeys: number;
  duplicateConfigurations: number;
  modelSlugCollisions: number;
  configurationsWithoutScheduleMapping: number;
  emptySchedules: number;
  summary: VehicleCatalogSummary;
  issues: VehicleCatalogIssue[];
}

export interface VehicleCatalogResult {
  report: VehicleCatalogValidationReport;
  catalog?: VehicleCatalog;
}

interface SourceRow {
  "Config Key": string;
  "Year": number;
  "Make": string;
  "Model": string;
  "Trim": string;
  "Engine Type": string;
  "Engine Size": string;
  "Engine": string;
  "Drivetrain": string;
  "Transmission": string;
  "Driving Condition": string;
  "Schedule Hash": string;
  "Mileage Point Count": number;
  "Service Item Count": number;
  "Schedule Text Chars": number;
  "Schedule JSON Chars": number;
  "Schedule JSON": string;
  "Schedule Text": string;
  "Source": string;
}

interface SourceFacts {
  sourceFile: string;
  sourceSha256: string;
  sourceBytes: number;
}

interface BuilderOptions {
  templateHashes?: ReadonlySet<string>;
}

const NON_EMPTY_STRING_FIELDS: SourceField[] = [
  "Config Key",
  "Make",
  "Model",
  "Trim",
  "Engine Type",
  "Engine Size",
  "Engine",
  "Drivetrain",
  "Transmission",
  "Driving Condition",
  "Schedule Hash",
  "Schedule JSON",
  "Source",
];

const STRING_FIELDS: SourceField[] = [
  ...NON_EMPTY_STRING_FIELDS,
  "Schedule Text",
];

const INTEGER_FIELDS: SourceField[] = [
  "Year",
  "Mileage Point Count",
  "Service Item Count",
  "Schedule Text Chars",
  "Schedule JSON Chars",
];

const CONFIG_KEY_RE = /^[a-f0-9]{40}$/;
const SCHEDULE_HASH_RE = /^[a-f0-9]{64}$/;

function canonical(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function codePointLength(value: string): number {
  let length = 0;
  for (const _ of value) length++;
  return length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeIssue(
  severity: ValidationSeverity,
  code: VehicleCatalogIssue["code"],
  line: number | undefined,
  message: string,
  field?: SourceField,
): VehicleCatalogIssue {
  return { severity, code, line, field, message };
}

export function modelSlug(model: string): string {
  return model
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function normalizedConfigurationTuple(row: SourceRow, includeCondition: boolean): string {
  const dimensions: Array<string | number> = [
    row.Year,
    canonical(row.Make),
    canonical(row.Model),
    canonical(row.Trim),
    canonical(row["Engine Type"]),
    canonical(row["Engine Size"]),
    canonical(row.Engine),
    canonical(row.Transmission),
    canonical(row.Drivetrain),
  ];
  if (includeCondition) dimensions.push(canonical(row["Driving Condition"]));
  return dimensions.join("\u001f");
}

function stableConfigurationGroupId(row: SourceRow): string {
  return createHash("sha1").update(normalizedConfigurationTuple(row, false)).digest("hex");
}

function validateSchedule(row: SourceRow, line: number): { emptySchedule: boolean; issues: VehicleCatalogIssue[] } {
  const issues: VehicleCatalogIssue[] = [];
  let schedule: unknown;
  try {
    schedule = JSON.parse(row["Schedule JSON"]);
  } catch (error) {
    issues.push(makeIssue(
      "error",
      "INVALID_SCHEDULE_JSON",
      line,
      `Schedule JSON is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      "Schedule JSON",
    ));
    return { emptySchedule: false, issues };
  }

  if (!Array.isArray(schedule)) {
    issues.push(makeIssue("error", "INVALID_SCHEDULE_JSON", line, "Schedule JSON must decode to an array", "Schedule JSON"));
    return { emptySchedule: false, issues };
  }

  const mileages = new Set<number>();
  for (let index = 0; index < schedule.length; index++) {
    const item = schedule[index];
    if (!isPlainObject(item) || !Number.isInteger(item.mileage) || Number(item.mileage) <= 0) {
      issues.push(makeIssue(
        "error",
        "INVALID_SCHEDULE_ITEM",
        line,
        `Schedule item ${index} must be an object with a positive integer mileage`,
        "Schedule JSON",
      ));
      continue;
    }
    mileages.add(Number(item.mileage));
  }

  if (schedule.length !== row["Service Item Count"]) {
    issues.push(makeIssue(
      "error",
      "SCHEDULE_COUNT_MISMATCH",
      line,
      `Service Item Count ${row["Service Item Count"]} does not match ${schedule.length} embedded schedule items`,
      "Service Item Count",
    ));
  }
  if (mileages.size !== row["Mileage Point Count"]) {
    issues.push(makeIssue(
      "error",
      "SCHEDULE_COUNT_MISMATCH",
      line,
      `Mileage Point Count ${row["Mileage Point Count"]} does not match ${mileages.size} embedded mileage points`,
      "Mileage Point Count",
    ));
  }
  if (codePointLength(row["Schedule JSON"]) !== row["Schedule JSON Chars"]) {
    issues.push(makeIssue(
      "error",
      "CHAR_COUNT_MISMATCH",
      line,
      `Schedule JSON Chars ${row["Schedule JSON Chars"]} does not match embedded content length ${codePointLength(row["Schedule JSON"])}`,
      "Schedule JSON Chars",
    ));
  }
  if (codePointLength(row["Schedule Text"]) !== row["Schedule Text Chars"]) {
    issues.push(makeIssue(
      "error",
      "CHAR_COUNT_MISMATCH",
      line,
      `Schedule Text Chars ${row["Schedule Text Chars"]} does not match embedded content length ${codePointLength(row["Schedule Text"])}`,
      "Schedule Text Chars",
    ));
  }

  const emptySchedule = schedule.length === 0;
  if (emptySchedule) {
    issues.push(makeIssue(
      "warning",
      "EMPTY_SCHEDULE",
      line,
      "Configuration has an authentic empty embedded schedule and is retained",
      "Schedule JSON",
    ));
  }
  return { emptySchedule, issues };
}

export function normalizeVehicleSourceRow(
  value: unknown,
  line: number,
): { record?: VehicleConfigurationOption; tupleKey?: string; issues: VehicleCatalogIssue[] } {
  const issues: VehicleCatalogIssue[] = [];
  if (!isPlainObject(value)) {
    return { issues: [makeIssue("error", "INVALID_ROW", line, "Source row must be a JSON object")] };
  }

  const sourceFieldSet = new Set<string>(SOURCE_FIELDS);
  for (const field of SOURCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      issues.push(makeIssue("error", "MISSING_FIELD", line, `Missing required source field: ${field}`, field));
    }
  }
  for (const field of Object.keys(value)) {
    if (!sourceFieldSet.has(field)) {
      issues.push(makeIssue("error", "UNEXPECTED_FIELD", line, `Unexpected source field: ${field}`));
    }
  }
  for (const field of STRING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field) && typeof value[field] !== "string") {
      issues.push(makeIssue("error", "INVALID_TYPE", line, `${field} must be a string`, field));
    }
  }
  for (const field of NON_EMPTY_STRING_FIELDS) {
    if (typeof value[field] === "string" && value[field].trim().length === 0) {
      issues.push(makeIssue("error", "MISSING_FIELD", line, `${field} must not be empty`, field));
    }
  }
  for (const field of INTEGER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field) && !Number.isInteger(value[field])) {
      issues.push(makeIssue("error", "INVALID_TYPE", line, `${field} must be an integer`, field));
    }
  }
  if (issues.some((issue) => issue.severity === "error")) return { issues };

  const row = value as unknown as SourceRow;
  if (row.Year < MIN_SUPPORTED_YEAR || row.Year > MAX_SUPPORTED_YEAR) {
    issues.push(makeIssue(
      "error",
      "INVALID_YEAR",
      line,
      `Year ${row.Year} is outside the supported ${MIN_SUPPORTED_YEAR}-${MAX_SUPPORTED_YEAR} range`,
      "Year",
    ));
  }
  for (const field of ["Mileage Point Count", "Service Item Count", "Schedule Text Chars", "Schedule JSON Chars"] as const) {
    if (row[field] < 0) {
      issues.push(makeIssue("error", "INVALID_TYPE", line, `${field} must be a non-negative integer`, field));
    }
  }
  if (!CONFIG_KEY_RE.test(row["Config Key"])) {
    issues.push(makeIssue("error", "INVALID_CONFIG_KEY", line, "Config Key must be 40 lowercase hexadecimal characters", "Config Key"));
  }
  if (!SCHEDULE_HASH_RE.test(row["Schedule Hash"])) {
    issues.push(makeIssue("error", "INVALID_SCHEDULE_HASH", line, "Schedule Hash must be 64 lowercase hexadecimal characters", "Schedule Hash"));
  }

  let engineVariant: string | null = null;
  let normalizedEngineSize = row["Engine Size"].trim();
  try {
    const parts = splitEngine(row.Engine.trim());
    engineVariant = parts.engineVariant;
    normalizedEngineSize = parts.engineSize;
    const expectedEngine = `${row["Engine Type"].trim()} ${row["Engine Size"].trim()}`;
    if (canonical(row.Engine) !== canonical(expectedEngine)) {
      issues.push(makeIssue(
        "error",
        "ENGINE_FIELD_MISMATCH",
        line,
        `Engine ${JSON.stringify(row.Engine)} does not match Engine Type/Size ${JSON.stringify(`${row["Engine Type"]} ${row["Engine Size"]}`)}`,
        "Engine",
      ));
    }
  } catch (error) {
    issues.push(makeIssue(
      "error",
      "INVALID_ENGINE",
      line,
      error instanceof Error ? error.message : String(error),
      "Engine",
    ));
  }

  const slug = modelSlug(row.Model);
  if (slug.length === 0) {
    issues.push(makeIssue("error", "EMPTY_MODEL_SLUG", line, `Model ${JSON.stringify(row.Model)} cannot produce a route-safe slug`, "Model"));
  }

  const scheduleFacts = validateSchedule(row, line);
  issues.push(...scheduleFacts.issues);
  if (issues.some((issue) => issue.severity === "error")) return { issues };

  const tupleKey = normalizedConfigurationTuple(row, true);
  const make = row.Make.trim();
  const model = row.Model.trim();
  const modelId = `${row.Year}:${modelSlug(make)}:${slug}`;
  return {
    tupleKey,
    issues,
    record: {
      configId: row["Config Key"],
      scheduleKey: row["Config Key"],
      configurationGroupId: stableConfigurationGroupId(row),
      modelId,
      year: row.Year,
      make,
      model,
      modelSlug: slug,
      trim: row.Trim.trim(),
      engine: row.Engine.trim(),
      engineType: row["Engine Type"].trim(),
      engineSize: normalizedEngineSize,
      engineVariant,
      transmission: row.Transmission.trim(),
      drivetrain: row.Drivetrain.trim(),
      condition: row["Driving Condition"].trim(),
      scheduleHash: row["Schedule Hash"],
      mileagePointCount: row["Mileage Point Count"],
      serviceItemCount: row["Service Item Count"],
      emptySchedule: scheduleFacts.emptySchedule,
      source: row.Source.trim(),
    },
  };
}

function sortConfigurations(records: VehicleConfigurationOption[]): VehicleConfigurationOption[] {
  return records.sort((a, b) =>
    a.year - b.year ||
    compareText(a.make, b.make) ||
    compareText(a.model, b.model) ||
    compareText(a.trim, b.trim) ||
    compareText(a.engine, b.engine) ||
    compareText(a.transmission, b.transmission) ||
    compareText(a.drivetrain, b.drivetrain) ||
    compareText(a.condition, b.condition) ||
    compareText(a.configId, b.configId));
}

function buildSummaries(records: VehicleConfigurationOption[], unmappedCount: number): {
  summary: VehicleCatalogSummary;
  years: VehicleCatalogYearSummary[];
  models: VehicleCatalogModelSummary[];
} {
  const byYear = new Map<number, VehicleConfigurationOption[]>();
  const byModel = new Map<string, VehicleConfigurationOption[]>();
  for (const record of records) {
    const yearRows = byYear.get(record.year) ?? [];
    yearRows.push(record);
    byYear.set(record.year, yearRows);
    const modelRows = byModel.get(record.modelId) ?? [];
    modelRows.push(record);
    byModel.set(record.modelId, modelRows);
  }

  const years: VehicleCatalogYearSummary[] = [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, rows]) => ({
      year,
      makeCount: new Set(rows.map((row) => canonical(row.make))).size,
      modelCount: new Set(rows.map((row) => row.modelId)).size,
      configurationCount: rows.length,
      physicalConfigurationCount: new Set(rows.map((row) => row.configurationGroupId)).size,
      emptyScheduleCount: rows.filter((row) => row.emptySchedule).length,
    }));

  const models: VehicleCatalogModelSummary[] = [...byModel.values()]
    .map((rows) => {
      const first = rows[0];
      return {
        id: first.modelId,
        year: first.year,
        make: first.make,
        model: first.model,
        modelSlug: first.modelSlug,
        displayName: first.model,
        configurationCount: rows.length,
        physicalConfigurationCount: new Set(rows.map((row) => row.configurationGroupId)).size,
        emptyScheduleCount: rows.filter((row) => row.emptySchedule).length,
        conditions: [...new Set(rows.map((row) => row.condition))].sort(compareText),
      };
    })
    .sort((a, b) => a.year - b.year || compareText(a.make, b.make) || compareText(a.model, b.model));

  const summary: VehicleCatalogSummary = {
    totalYears: years.length,
    totalModels: models.length,
    distinctModelNames: new Set(records.map((row) => `${canonical(row.make)}\u001f${canonical(row.model)}`)).size,
    totalConfigurations: records.length,
    totalPhysicalConfigurations: new Set(records.map((row) => row.configurationGroupId)).size,
    totalSchedules: new Set(records.map((row) => row.scheduleHash)).size,
    emptySchedules: records.filter((row) => row.emptySchedule).length,
    configurationsWithoutScheduleMapping: unmappedCount,
    countsByYear: years,
  };
  return { summary, years, models };
}

export class VehicleCatalogBuilder {
  private readonly templateHashes?: ReadonlySet<string>;
  private readonly records: VehicleConfigurationOption[] = [];
  private readonly issues: VehicleCatalogIssue[] = [];
  private readonly configKeyLines = new Map<string, number>();
  private readonly tupleLines = new Map<string, number>();
  private readonly modelSlugOwners = new Map<string, { owner: string; line: number }>();
  private inputRows = 0;

  constructor(options: BuilderOptions = {}) {
    this.templateHashes = options.templateHashes;
  }

  addInvalidJson(line: number, message: string): void {
    this.inputRows++;
    this.issues.push(makeIssue("error", "INVALID_JSON", line, message));
  }

  add(value: unknown, line: number): void {
    this.inputRows++;
    const normalized = normalizeVehicleSourceRow(value, line);
    this.issues.push(...normalized.issues);
    const record = normalized.record;
    if (!record || !normalized.tupleKey) return;

    const existingKeyLine = this.configKeyLines.get(record.configId);
    if (existingKeyLine !== undefined) {
      this.issues.push(makeIssue(
        "error",
        "DUPLICATE_CONFIG_KEY",
        line,
        `Config Key ${record.configId} duplicates line ${existingKeyLine}`,
        "Config Key",
      ));
    } else {
      this.configKeyLines.set(record.configId, line);
    }

    const existingTupleLine = this.tupleLines.get(normalized.tupleKey);
    if (existingTupleLine !== undefined) {
      this.issues.push(makeIssue(
        "error",
        "DUPLICATE_CONFIGURATION",
        line,
        `Normalized condition-specific configuration duplicates line ${existingTupleLine}`,
      ));
    } else {
      this.tupleLines.set(normalized.tupleKey, line);
    }

    const ownerKey = `${record.year}\u001f${record.modelSlug}`;
    const owner = `${canonical(record.make)}\u001f${canonical(record.model)}`;
    const existingOwner = this.modelSlugOwners.get(ownerKey);
    if (existingOwner && existingOwner.owner !== owner) {
      this.issues.push(makeIssue(
        "error",
        "MODEL_SLUG_COLLISION",
        line,
        `Model route slug ${record.modelSlug} collides with line ${existingOwner.line} in ${record.year}`,
        "Model",
      ));
    } else if (!existingOwner) {
      this.modelSlugOwners.set(ownerKey, { owner, line });
    }

    if (this.templateHashes && !this.templateHashes.has(record.scheduleHash)) {
      this.issues.push(makeIssue(
        "error",
        "UNMAPPED_SCHEDULE",
        line,
        `Schedule Hash ${record.scheduleHash} is absent from the template index`,
        "Schedule Hash",
      ));
    }

    this.records.push(record);
  }

  finish(mode: CoverageMode, source: SourceFacts): VehicleCatalogResult {
    const sortedRecords = sortConfigurations([...this.records]);
    const years = new Set(sortedRecords.map((record) => record.year));
    const missingYears: number[] = [];
    for (let year = MIN_SUPPORTED_YEAR; year <= MAX_SUPPORTED_YEAR; year++) {
      if (!years.has(year)) missingYears.push(year);
    }

    const coverageIssue = missingYears.length > 0
      ? makeIssue(
          mode === "full" ? "error" : "warning",
          "MISSING_YEAR_COVERAGE",
          undefined,
          `Source is missing supported year${missingYears.length === 1 ? "" : "s"}: ${missingYears.join(", ")}`,
        )
      : undefined;
    const allIssues = coverageIssue ? [...this.issues, coverageIssue] : [...this.issues];
    const integrityErrors = this.issues.filter((issue) => issue.severity === "error");
    const coverageErrorCount = coverageIssue?.severity === "error" ? 1 : 0;
    const unmappedLines = new Set(this.issues
      .filter((issue) => issue.code === "UNMAPPED_SCHEDULE" || issue.code === "INVALID_SCHEDULE_HASH" ||
        (issue.field === "Schedule Hash" && issue.code === "MISSING_FIELD"))
      .map((issue) => issue.line)
      .filter((line): line is number => line !== undefined));
    const summaries = buildSummaries(sortedRecords, unmappedLines.size);
    const report: VehicleCatalogValidationReport = {
      ok: integrityErrors.length === 0 && coverageErrorCount === 0,
      mode,
      sourceFile: source.sourceFile,
      sourceRows: this.inputRows,
      validConfigurations: sortedRecords.length,
      integrityErrorCount: integrityErrors.length,
      warningCount: allIssues.filter((issue) => issue.severity === "warning").length,
      coverageErrorCount,
      missingYears,
      duplicateConfigKeys: this.issues.filter((issue) => issue.code === "DUPLICATE_CONFIG_KEY").length,
      duplicateConfigurations: this.issues.filter((issue) => issue.code === "DUPLICATE_CONFIGURATION").length,
      modelSlugCollisions: this.issues.filter((issue) => issue.code === "MODEL_SLUG_COLLISION").length,
      configurationsWithoutScheduleMapping: unmappedLines.size,
      emptySchedules: sortedRecords.filter((record) => record.emptySchedule).length,
      summary: summaries.summary,
      issues: allIssues,
    };

    if (!report.ok) return { report };

    const sourceYears = [...years].sort((a, b) => a - b);
    const catalog: VehicleCatalog = {
      metadata: {
        schemaVersion: VEHICLE_CATALOG_SCHEMA_VERSION,
        sourceFile: source.sourceFile,
        sourceSha256: source.sourceSha256,
        sourceBytes: source.sourceBytes,
        sourceRows: this.inputRows,
        supportedYearRange: { min: MIN_SUPPORTED_YEAR, max: MAX_SUPPORTED_YEAR },
        sourceYearRange: {
          min: sourceYears.length > 0 ? sourceYears[0] : null,
          max: sourceYears.length > 0 ? sourceYears[sourceYears.length - 1] : null,
        },
        missingYears,
        coverage: missingYears.length === 0 ? "complete" : "partial",
        scheduleMappingValidation: this.templateHashes ? "template-index" : "embedded",
      },
      summary: summaries.summary,
      years: summaries.years,
      models: summaries.models,
      configurations: sortedRecords,
    };
    return { report, catalog };
  }
}
