import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");

/**
 * Constraint: Airtable is an admin/editing layer only. The customer lookup
 * API must keep working with Airtable down, and must never hold a token.
 * This test makes the isolation a build-time guarantee, not a convention.
 */
describe("customer lookup reads SQLite only (test 7)", () => {
  it("server source never imports, requires, or calls Airtable", () => {
    // Comments documenting the isolation invariant are allowed; code paths are not.
    for (const f of readdirSync(join(serverRoot, "src"))) {
      const text = readFileSync(join(serverRoot, "src", f), "utf8");
      expect(text, `${f}: import`).not.toMatch(/from ["'][^"']*airtable/i);
      expect(text, `${f}: require`).not.toMatch(/require\(["'][^"']*airtable/i);
      expect(text, `${f}: API URL`).not.toMatch(/api\.airtable\.com/i);
    }
  });

  it("server has no Airtable dependency and no sync-module import", () => {
    const pkg = JSON.parse(readFileSync(join(serverRoot, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ");
    expect(deps).not.toMatch(/airtable/i);

    for (const f of readdirSync(join(serverRoot, "src"))) {
      const text = readFileSync(join(serverRoot, "src", f), "utf8");
      expect(text, `${f} must not import from etl`).not.toMatch(/from ["'].*etl\//);
    }
  });

  it("no AIRTABLE_* env var is read anywhere in the lookup service", () => {
    for (const f of readdirSync(join(serverRoot, "src"))) {
      const text = readFileSync(join(serverRoot, "src", f), "utf8");
      expect(text, f).not.toMatch(/AIRTABLE_/);
    }
  });
});
