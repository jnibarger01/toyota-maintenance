import { describe, expect, it } from "vitest";
import { modelSlug } from "../src/data/schema";

describe("vehicle route identity", () => {
  it("matches the generated catalog slug contract", () => {
    expect(modelSlug("  Camión & Sport -- Plus  ")).toBe("camion-and-sport-plus");
  });
});
