import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONFIG_KEY, configRecord, gridResponse, installFetchMock, lookupResult, optionsResponse } from "./fixtures";
import { renderApp } from "./renderApp";

afterEach(() => vi.unstubAllGlobals());

async function toDetails(user: ReturnType<typeof userEvent.setup>) {
  renderApp();
  await user.click(await screen.findByRole("link", { name: "2020" }));
  await user.click(await screen.findByRole("link", { name: /4RUNNER/i }));
  await screen.findByRole("heading", { name: /vehicle details/i });
}

describe("form validation", () => {
  it("requires every multi-option configuration dimension before lookup", async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const multiOptions = {
      ...optionsResponse,
      trims: ["SR5"],
      engines: [
        { engine: "V8 5.7L", engine_type: "V8", engine_size: "5.7L", engine_variant: null },
        { engine: "V8 5.7L - FFV", engine_type: "V8", engine_size: "5.7L", engine_variant: "FFV" },
      ],
      engine_types: ["V8"],
      engine_sizes: ["5.7L"],
      drivetrains: ["4WD"],
      transmissions: ["Automatic"],
    };
    const respond = (data: unknown) =>
      Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }));
    let selectedConfig = configRecord;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith("/api/years")) return respond({ years: [2020] });
      if (url.startsWith("/api/models")) return respond({ year: 2020, models: ["4RUNNER"] });
      if (url.startsWith("/api/options")) return respond(multiOptions);
      if (url === `/api/configs/${CONFIG_KEY}`) return respond(selectedConfig);
      if (url.startsWith("/api/configs?")) {
        const search = new URL(url, "http://local").searchParams;
        selectedConfig = {
          ...configRecord,
          engine: search.get("engine"),
          engine_type: "V8",
          engine_size: "5.7L",
          engine_variant: search.get("engine")?.includes("FFV") ? "FFV" : null,
        };
        return respond({ count: 1, truncated: false, configs: [selectedConfig] });
      }
      if (url === "/api/maintenance/lookup") return respond(lookupResult);
      if (url.startsWith("/api/maintenance/grid")) return respond(gridResponse);
      return respond({ error: `unmocked ${url}` });
    });

    const user = userEvent.setup();
    await toDetails(user);
    await user.click(screen.getByRole("button", { name: "Normal" }));
    const submit = screen.getByRole("button", { name: /show details/i });
    expect(submit).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/^engine \*/i), "V8 5.7L - FFV");
    await user.type(screen.getByLabelText(/current mileage/i), "70000");
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    await screen.findByRole("heading", { name: /2020 TOYOTA 4RUNNER/i });
    expect(requests.find((request) => request.url === "/api/maintenance/lookup")?.body).toMatchObject({
      engine: "V8 5.7L - FFV",
    });
  });

  it("requires an explicit customer mileage plus trim, drivetrain, and condition", async () => {
    installFetchMock(vi);
    const user = userEvent.setup();
    await toDetails(user);

    const submit = screen.getByRole("button", { name: /show details/i });
    expect(submit).toBeDisabled();

    expect(screen.getByLabelText(/current mileage/i)).toHaveValue("");
    expect(screen.getByLabelText(/avg monthly mileage/i)).toHaveValue("");

    // Single-option dimensions auto-filled; multi-option chips required.
    expect(screen.getByLabelText(/^engine \*/i)).toHaveValue("V6 4.0L");
    await user.selectOptions(screen.getByLabelText(/^trim/i), "SR5");
    expect(submit).toBeDisabled(); // drivetrain and condition are still missing
    await user.click(screen.getByRole("button", { name: "4WD" }));
    expect(submit).toBeDisabled(); // condition still missing
    await user.click(screen.getByRole("button", { name: "Normal" }));
    await user.type(screen.getByLabelText(/current mileage/i), "70000");
    expect(submit).toBeEnabled();
    expect(screen.getByRole("button", { name: "Normal" })).toHaveAttribute("aria-pressed", "true");
  });

  it("invalid mileage disables submission again", async () => {
    installFetchMock(vi);
    const user = userEvent.setup();
    await toDetails(user);
    await user.selectOptions(screen.getByLabelText(/^trim/i), "SR5");
    await user.click(screen.getByRole("button", { name: "4WD" }));
    await user.click(screen.getByRole("button", { name: "Normal" }));

    const mileage = screen.getByLabelText(/current mileage/i);
    await user.clear(mileage);
    expect(screen.getByRole("button", { name: /show details/i })).toBeDisabled();
    await user.type(mileage, "72500");
    expect(screen.getByRole("button", { name: /show details/i })).toBeEnabled();
  });

  it("refetches options and clears an invalid downstream drivetrain after trim changes", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const respond = (data: unknown) =>
      Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }));
    let selectedConfig = configRecord;

    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.startsWith("/api/years")) return respond({ years: [2020] });
      if (url.startsWith("/api/models")) return respond({ year: 2020, models: ["4RUNNER"] });
      if (url.startsWith("/api/options") && url.includes("trim=TRD+Pro")) {
        return respond({ ...optionsResponse, trims: ["TRD Pro"], drivetrains: ["4WD"] });
      }
      if (url.startsWith("/api/options")) return respond(optionsResponse);
      if (url === `/api/configs/${CONFIG_KEY}`) return respond(selectedConfig);
      if (url.startsWith("/api/configs?")) {
        const search = new URL(url, "http://local").searchParams;
        selectedConfig = {
          ...configRecord,
          trim: search.get("trim"),
          drivetrain: search.get("drivetrain"),
        };
        return respond({ count: 1, truncated: false, configs: [selectedConfig] });
      }
      if (url.startsWith("/api/maintenance/lookup")) return respond(lookupResult);
      if (url.startsWith("/api/maintenance/grid")) return respond(gridResponse);
      return Promise.resolve(new Response(JSON.stringify({ error: `unmocked ${url}` }), { status: 404 }));
    });

    const user = userEvent.setup();
    await toDetails(user);
    await user.click(screen.getByRole("button", { name: "RWD" }));
    await user.click(screen.getByRole("button", { name: "Normal" }));
    expect(screen.getByRole("button", { name: /show details/i })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/^trim/i), "TRD Pro");
    await waitFor(() => expect(screen.queryByRole("button", { name: "RWD" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "4WD" })).toHaveAttribute("aria-pressed", "true");
    await user.type(screen.getByLabelText(/current mileage/i), "70000");
    expect(screen.getByRole("button", { name: /show details/i })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /show details/i }));
    await screen.findByRole("heading", { name: /2020 TOYOTA 4RUNNER/i });
    const lookup = calls.find((c) => c.url === "/api/maintenance/lookup");
    expect(lookup?.body).toMatchObject({ trim: "TRD Pro", drivetrain: "4WD" });
    expect(JSON.stringify(lookup?.body)).not.toContain("RWD");
  });
});
