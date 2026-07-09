import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(cleanup);

// jsdom has no print implementation; give tests something to spy on.
if (typeof window !== "undefined" && !window.print) {
  window.print = () => {};
}
