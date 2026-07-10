/**
 * Stream config_schedules.jsonl into a compact, customer-safe vehicle catalog.
 * Raw schedule bodies and task edges are validated, then deliberately omitted.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { VehicleCatalogBuilder, type CoverageMode, type VehicleCatalogIssue } from "./vehicle-catalog.js";

interface Args {
  mode: CoverageMode;
  input: string;
  templateIndex?: string;
  out?: string;
}

function usage(): string {
  return [
    "Usage: node etl/dist/import-vehicle-catalog.js [options]",
    "",
    "Options:",
    "  --data-dir DIR         Directory containing config_schedules.jsonl",
    "  --input FILE           Explicit config_schedules JSONL path",
    "  --template-index FILE  Optional unique_schedule_templates.jsonl for hash mapping validation",
    "  --mode sample|full     sample permits coverage gaps; full requires every year 2000-2026",
    "  --strict-coverage      Alias for --mode full",
    "  --out FILE             Write deterministic compact catalog JSON after validation",
  ].join("\n");
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv: string[]): Args {
  let dataDir = "data";
  let explicitInput: string | undefined;
  let explicitTemplateIndex: string | undefined;
  let out: string | undefined;
  let mode: CoverageMode = "sample";
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--data-dir") dataDir = requireValue(argv, index++, arg);
    else if (arg === "--input") explicitInput = requireValue(argv, index++, arg);
    else if (arg === "--template-index") explicitTemplateIndex = requireValue(argv, index++, arg);
    else if (arg === "--out") out = requireValue(argv, index++, arg);
    else if (arg === "--mode") {
      const value = requireValue(argv, index++, arg);
      if (value !== "sample" && value !== "full") throw new Error(`Unsupported mode: ${value}`);
      mode = value;
    } else if (arg === "--strict-coverage") mode = "full";
    else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }

  const resolvedDataDir = resolve(dataDir);
  const input = resolve(explicitInput ?? join(resolvedDataDir, "config_schedules.jsonl"));
  const defaultTemplateIndex = join(resolvedDataDir, "unique_schedule_templates.jsonl");
  const templateIndex = explicitTemplateIndex
    ? resolve(explicitTemplateIndex)
    : existsSync(defaultTemplateIndex) ? defaultTemplateIndex : undefined;
  return { mode, input, templateIndex, out: out ? resolve(out) : undefined };
}

async function loadTemplateHashes(path: string): Promise<Set<string>> {
  const hashes = new Set<string>();
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid template JSON at ${path}:${lineNo}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Invalid template row at ${path}:${lineNo}: expected an object`);
    }
    const hash = (value as Record<string, unknown>)["Schedule Hash"];
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error(`Invalid Schedule Hash at ${path}:${lineNo}`);
    }
    if (hashes.has(hash)) throw new Error(`Duplicate Schedule Hash ${hash} at ${path}:${lineNo}`);
    hashes.add(hash);
  }
  return hashes;
}

function printIssue(issue: VehicleCatalogIssue): void {
  const location = issue.line === undefined ? "" : ` line ${issue.line}`;
  const field = issue.field ? ` [${issue.field}]` : "";
  console.error(`  ${issue.severity.toUpperCase()} ${issue.code}${location}${field}: ${issue.message}`);
}

async function run(args: Args): Promise<void> {
  if (!existsSync(args.input)) throw new Error(`Missing source file: ${args.input}`);
  if (args.templateIndex && !existsSync(args.templateIndex)) throw new Error(`Missing template index: ${args.templateIndex}`);

  const templateHashes = args.templateIndex ? await loadTemplateHashes(args.templateIndex) : undefined;
  const builder = new VehicleCatalogBuilder({ templateHashes });
  const sourceHash = createHash("sha256");
  let sourceBytes = 0;
  const stream = createReadStream(args.input);
  stream.on("data", (chunk: string | Buffer) => {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    sourceHash.update(bytes);
    sourceBytes += bytes.length;
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      builder.addInvalidJson(lineNo, error instanceof Error ? error.message : String(error));
      continue;
    }
    builder.add(value, lineNo);
  }

  const result = builder.finish(args.mode, {
    sourceFile: basename(args.input),
    sourceSha256: sourceHash.digest("hex"),
    sourceBytes,
  });
  const { report } = result;
  const status = report.ok ? "OK" : "FAILED";
  console.log(`Vehicle catalog validation ${status}`);
  console.log(`  source                     ${args.input}`);
  console.log(`  mode                       ${report.mode}`);
  console.log(`  source rows                ${report.sourceRows}`);
  console.log(`  years                      ${report.summary.totalYears}`);
  console.log(`  year/model groups          ${report.summary.totalModels}`);
  console.log(`  distinct model names       ${report.summary.distinctModelNames}`);
  console.log(`  configurations             ${report.summary.totalConfigurations}`);
  console.log(`  physical configurations    ${report.summary.totalPhysicalConfigurations}`);
  console.log(`  schedule hashes            ${report.summary.totalSchedules}`);
  console.log(`  empty schedules            ${report.emptySchedules}`);
  console.log(`  unmapped configurations    ${report.configurationsWithoutScheduleMapping}`);
  console.log(`  missing years              ${report.missingYears.length > 0 ? report.missingYears.join(", ") : "none"}`);
  console.log(`  integrity errors           ${report.integrityErrorCount}`);
  console.log(`  coverage errors            ${report.coverageErrorCount}`);
  console.log(`  warnings                   ${report.warningCount}`);
  console.log("  configurations by year");
  for (const year of report.summary.countsByYear) {
    console.log(`    ${year.year} ${String(year.configurationCount).padStart(5)} configs, ${String(year.modelCount).padStart(3)} models`);
  }

  for (const issue of report.issues.slice(0, 50)) printIssue(issue);
  if (report.issues.length > 50) console.error(`  ... ${report.issues.length - 50} additional issue(s) omitted`);

  if (!report.ok || !result.catalog) {
    process.exitCode = 1;
    return;
  }

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    const tempPath = `${args.out}.tmp.${process.pid}`;
    try {
      writeFileSync(tempPath, `${JSON.stringify(result.catalog)}\n`);
      renameSync(tempPath, args.out);
    } finally {
      rmSync(tempPath, { force: true });
    }
    console.log(`  catalog                    ${args.out}`);
  }
}

run(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
