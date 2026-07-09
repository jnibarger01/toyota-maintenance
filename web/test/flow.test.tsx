import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { installFetchMock } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("year/model selection flow", () => {
  it("walks year -> model -> details, loading data at each step", async () => {
    const calls = installFetchMock(vi);
    const user = userEvent.setup();
    render(<App />);

    // Step 1: years load and render as tiles.
    expect(await screen.findByRole("heading", { name: /select model year/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2020" }));

    // Step 2: models for that year.
    expect(await screen.findByRole("heading", { name: /select model/i })).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/models?year=2020")).toBe(true);
    await user.click(screen.getByRole("button", { name: "4RUNNER" }));

    // Step 3: details form driven by the options endpoint.
    expect(await screen.findByRole("heading", { name: /vehicle details/i })).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/options?year=2020&model=4RUNNER"))).toBe(true);
    expect(screen.getByRole("button", { name: "Normal" })).toBeInTheDocument();
  });

  it("supports going back to change year", async () => {
    installFetchMock(vi);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "2020" }));
    await user.click(await screen.findByRole("button", { name: /change year/i }));
    expect(await screen.findByRole("heading", { name: /select model year/i })).toBeInTheDocument();
  });
});
