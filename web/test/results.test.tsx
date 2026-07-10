import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONFIG_KEY, configRecord, gridResponse, installFetchMock, lookupResult, optionsResponse } from "./fixtures";
import { renderApp } from "./renderApp";

afterEach(() => vi.unstubAllGlobals());

async function toResults(user: ReturnType<typeof userEvent.setup>) {
  const calls = installFetchMock(vi);
  renderApp();
  await user.click(await screen.findByRole("link", { name: "2020" }));
  await user.click(await screen.findByRole("link", { name: /4RUNNER/i }));
  await screen.findByRole("heading", { name: /vehicle details/i });
  await user.selectOptions(screen.getByLabelText(/^trim/i), "SR5");
  await user.click(screen.getByRole("button", { name: "4WD" }));
  await user.click(screen.getByRole("button", { name: "Normal" }));
  await user.type(screen.getByLabelText(/current mileage/i), "70000");
  await user.click(screen.getByRole("button", { name: /show details/i }));
  await screen.findByRole("heading", { name: /2020 TOYOTA 4RUNNER/i });
  return calls;
}

describe("lookup result render", () => {
  it("retries a failed lookup instead of only dismissing the error", async () => {
    let lookupCalls = 0;
    const respond = (data: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/years")) return respond({ years: [2020] });
      if (url.startsWith("/api/models")) return respond({ year: 2020, models: ["4RUNNER"] });
      if (url.startsWith("/api/options")) return respond(optionsResponse);
      if (url === `/api/configs/${CONFIG_KEY}`) return respond(configRecord);
      if (url.startsWith("/api/configs?")) return respond({ count: 1, truncated: false, configs: [configRecord] });
      if (url.startsWith("/api/maintenance/grid")) return respond(gridResponse);
      if (url === "/api/maintenance/lookup") {
        lookupCalls += 1;
        return lookupCalls === 1 ? respond({ error: "temporary lookup failure" }, 503) : respond(lookupResult);
      }
      return respond({ error: `unmocked ${url}` }, 404);
    });

    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("link", { name: "2020" }));
    await user.click(await screen.findByRole("link", { name: /4RUNNER/i }));
    await user.selectOptions(await screen.findByLabelText(/^trim/i), "SR5");
    await user.click(screen.getByRole("button", { name: "4WD" }));
    await user.click(screen.getByRole("button", { name: "Normal" }));
    await user.type(screen.getByLabelText(/current mileage/i), "70000");
    await user.click(screen.getByRole("button", { name: /show details/i }));

    expect(await screen.findByText("temporary lookup failure")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: /2020 TOYOTA 4RUNNER/i })).toBeInTheDocument();
    expect(lookupCalls).toBe(2);
  });

  it("submits to lookup + grid and renders the results header with source badge", async () => {
    const user = userEvent.setup();
    const calls = await toResults(user);

    const lookup = calls.find((c) => c.url === "/api/maintenance/lookup");
    expect(lookup?.body).toMatchObject({
      year: 2020, model: "4RUNNER", trim: "SR5", drivetrain: "4WD", drivingCondition: "Normal",
      currentMileage: 70000,
    });
    expect(calls.some((c) => c.url.startsWith("/api/maintenance/grid?"))).toBe(true);

    expect(screen.getByText(/normal schedule/i)).toBeInTheDocument();
    expect(screen.getByText(/odometer 70,000 mi/i)).toBeInTheDocument();
    expect(screen.getByTitle(/factory schedule reference 317848a5f5 \/ 7d807a092e/i)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Maintenance summary")).getByText("7")).toBeInTheDocument();
  });

  it("grid tab renders columns with the current interval marked and service rows", async () => {
    const user = userEvent.setup();
    await toResults(user);

    const gridTab = screen.getByRole("tab", { name: "Grid" });
    expect(gridTab).toHaveAttribute("aria-selected", "true"); // default tab

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "0 mi" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "120,000 mi" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /70,000 mi current interval/i })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /75,000 mi next interval/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /current interval/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /next interval/i })).toBeEnabled();
    expect(within(table).getByText("Replace engine oil and oil filter")).toBeInTheDocument();
    expect(screen.getByText("Imported source description for the oil service task.")).toBeInTheDocument();
    expect(within(table).getByText("Oil & Consumables")).toBeInTheDocument(); // category group row
    expect(within(table).getByText(/service label: TIRE ROT/i)).toBeInTheDocument(); // advisor label stays secondary
    expect(within(table).getByText("Rotate tires")).toBeInTheDocument(); // raw Xtime name remains visible
    await user.click(within(table).getByRole("button", { name: /rotate tires, scheduled at 75,000 miles/i }));
    expect(screen.getByRole("complementary", { name: "Rotate tires" })).toBeInTheDocument();

    const oilCategory = within(table).getByRole("button", { name: /oil & consumables/i });
    expect(oilCategory).toHaveAttribute("aria-expanded", "true");
    await user.click(oilCategory);
    expect(oilCategory).toHaveAttribute("aria-expanded", "false");
    expect(within(table).queryByRole("button", { name: "Replace engine oil and oil filter" })).not.toBeInTheDocument();
    await user.click(oilCategory);
    expect(within(table).getByRole("button", { name: "Replace engine oil and oil filter" })).toBeInTheDocument();
  });

  it("list tab shows due/verify/upcoming groups; guide tab lazy-loads sections", async () => {
    const user = userEvent.setup();
    const calls = await toResults(user);

    await user.click(screen.getByRole("tab", { name: "List" }));
    expect(screen.getByRole("heading", { name: /at current interval · 70,000 miles/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /upcoming · 75,000 miles/i })).toBeInTheDocument();
    const dueGroup = screen.getByRole("heading", { name: /at current interval · 70,000 miles/i }).closest("section")!;
    expect(within(dueGroup).queryByText("$29.95")).not.toBeInTheDocument();
    expect(within(dueGroup).queryByText("Hidden internal inspection")).not.toBeInTheDocument();
    expect(within(dueGroup).queryByText("HIDDEN TASK")).not.toBeInTheDocument();

    expect(calls.some((c) => c.url === "/api/maintenance/guide")).toBe(false); // not fetched yet
    await user.click(screen.getByRole("tab", { name: "Owner's Guide" }));
    expect(await screen.findByRole("heading", { name: /vehicle summary/i })).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/maintenance/guide")).toBe(true);
    expect(screen.queryByRole("heading", { name: /internal advisor notes/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/internal — not printed/i)).not.toBeInTheDocument();
  });

  it("selects a factual inspector row and toggles its ephemeral print inclusion", async () => {
    const user = userEvent.setup();
    await toResults(user);

    await user.click(screen.getByRole("button", { name: /rotate tires service label/i }));
    expect(screen.getByRole("complementary", { name: "Rotate tires" })).toBeInTheDocument();
    expect(screen.getByText(/no additional description was included/i)).toBeInTheDocument();

    const remove = screen.getByRole("button", { name: /remove from printout/i });
    await user.click(remove);
    expect(screen.getByRole("button", { name: /include in printout/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /print 7 included tasks.*open print preview/i })).toBeInTheDocument();
  });
});
