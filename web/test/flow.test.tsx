import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock, optionsResponse } from "./fixtures";
import { renderApp } from "./renderApp";

afterEach(() => vi.unstubAllGlobals());

describe("year/model selection flow", () => {
  it("retries failed year, model, and option requests in place", async () => {
    const attempts = { years: 0, models: 0, options: 0 };
    const respond = (data: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/years")) {
        attempts.years += 1;
        return attempts.years === 1 ? respond({ error: "years unavailable" }, 503) : respond({ years: [2020] });
      }
      if (url.startsWith("/api/models")) {
        attempts.models += 1;
        return attempts.models === 1 ? respond({ error: "models unavailable" }, 503) : respond({ year: 2020, models: ["4RUNNER"] });
      }
      if (url.startsWith("/api/options")) {
        attempts.options += 1;
        return attempts.options === 1 ? respond({ error: "options unavailable" }, 503) : respond(optionsResponse);
      }
      return respond({ error: `unmocked ${url}` }, 404);
    });

    const user = userEvent.setup();
    renderApp();

    expect(await screen.findByText("years unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await user.click(await screen.findByRole("link", { name: "2020" }));
    expect(await screen.findByText("models unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await user.click(await screen.findByRole("link", { name: /4RUNNER/i }));
    expect(await screen.findByText("options unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: /vehicle details/i })).toBeInTheDocument();
    expect(attempts).toEqual({ years: 2, models: 4, options: 2 });
  });

  it("walks year -> model -> details, loading data at each step", async () => {
    const calls = installFetchMock(vi);
    const user = userEvent.setup();
    renderApp();

    // Step 1: years load and render as tiles.
    expect(await screen.findByRole("heading", { name: /select model year/i })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "2020" }));

    // Step 2: models for that year.
    expect(await screen.findByRole("heading", { name: /select model/i })).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/models?year=2020")).toBe(true);
    await user.click(screen.getByRole("link", { name: /4RUNNER/i }));

    // Step 3: details form driven by the options endpoint.
    expect(await screen.findByRole("heading", { name: /vehicle details/i })).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/options?year=2020&model=4RUNNER"))).toBe(true);
    expect(screen.getByRole("button", { name: "Normal" })).toBeInTheDocument();
  });

  it("supports going back to change year", async () => {
    installFetchMock(vi);
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("link", { name: "2020" }));
    await user.click(await screen.findByRole("link", { name: /change year/i }));
    expect(await screen.findByRole("heading", { name: /select model year/i })).toBeInTheDocument();
  });
});
