import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = resolve(here, "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * N6 guard — mirrors server/test/no-airtable.test.ts for the frontend.
 * Airtable is admin/backend only: the browser must never hold a token, import
 * a client, or reach a sync path. Prose comments documenting the invariant
 * are allowed; code paths are not.
 */
describe("frontend has zero Airtable surface (N6)", () => {
  const files = walk(webSrc).filter((f) => /\.(ts|tsx|css)$/.test(f));

  it("finds frontend source to scan", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("never imports or requires Airtable clients or backend sync modules", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, `${f}: import`).not.toMatch(/from ["'][^"']*airtable[^"']*["']/i);
      expect(text, `${f}: require`).not.toMatch(/require\(["'][^"']*airtable/i);
      expect(text, `${f}: etl import`).not.toMatch(/from ["'][^"']*\/etl\//);
    }
  });

  it("never references Airtable API URLs, tokens, env vars, or sync CLI paths", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, `${f}: API URL`).not.toMatch(/api\.airtable\.com/i);
      expect(text, `${f}: env/token`).not.toMatch(/AIRTABLE_[A-Z_]*/);
      expect(text, `${f}: token literal`).not.toMatch(/\bpat[A-Za-z0-9]{14,}/);
      expect(text, `${f}: sync path`).not.toMatch(/sync-airtable|sync:airtable/);
    }
  });

  it("web package.json carries no Airtable dependency", () => {
    const pkg = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ");
    expect(deps).not.toMatch(/airtable/i);
  });
});
