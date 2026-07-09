import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { installFetchMock } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

async function toResults(user: ReturnType<typeof userEvent.setup>) {
  const calls = installFetchMock(vi);
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "2020" }));
  await user.click(await screen.findByRole("button", { name: "4RUNNER" }));
  await screen.findByRole("heading", { name: /vehicle details/i });
  await user.click(screen.getByRole("button", { name: "4WD" }));
  await user.click(screen.getByRole("button", { name: "Normal" }));
  await user.click(screen.getByRole("button", { name: /show details/i }));
  await screen.findByRole("heading", { name: /2020 TOYOTA 4RUNNER/i });
  return calls;
}

describe("lookup result render", () => {
  it("submits to lookup + grid and renders the results header with source badge", async () => {
    const user = userEvent.setup();
    const calls = await toResults(user);

    const lookup = calls.find((c) => c.url === "/api/maintenance/lookup");
    expect(lookup?.body).toMatchObject({
      year: 2020, model: "4RUNNER", drivetrain: "4WD", drivingCondition: "Normal",
      currentMileage: 70000, avgMonthlyMileage: 833,
    });
    expect(calls.some((c) => c.url.startsWith("/api/maintenance/grid?"))).toBe(true);

    expect(screen.getByText(/normal schedule/i)).toBeInTheDocument();
    expect(screen.getByText(/odometer 70,000 mi/i)).toBeInTheDocument();
    expect(screen.getByTitle(/config 317848a5f5/i)).toBeInTheDocument(); // SourceBadge
  });

  it("grid tab renders columns with the current interval marked and service rows", async () => {
    const user = userEvent.setup();
    await toResults(user);

    const gridTab = screen.getByRole("tab", { name: "Grid" });
    expect(gridTab).toHaveAttribute("aria-selected", "true"); // default tab

    const table = screen.getByRole("table");
    expect(within(table).getByText("70,000")).toBeInTheDocument();
    expect(within(table).getByText(/current/i)).toBeInTheDocument();
    expect(within(table).getByText("Replace engine oil and oil filter")).toBeInTheDocument();
    expect(within(table).getByText("Oil & Consumables")).toBeInTheDocument(); // category group row
    expect(within(table).getByText("TIRE ROT")).toBeInTheDocument(); // advisor label overlay
  });

  it("list tab shows due/verify/upcoming groups; guide tab lazy-loads sections", async () => {
    const user = userEvent.setup();
    const calls = await toResults(user);

    await user.click(screen.getByRole("tab", { name: "List" }));
    expect(screen.getByRole("heading", { name: /due now · 70,000 miles/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /upcoming · 75,000 miles/i })).toBeInTheDocument();
    // Scope to the due-now group: the off-screen PrintSheet also carries the price.
    const dueGroup = screen.getByRole("heading", { name: /due now · 70,000 miles/i }).closest("section")!;
    expect(within(dueGroup).getByText("$29.95")).toBeInTheDocument(); // explicit dealership price only

    expect(calls.some((c) => c.url === "/api/maintenance/guide")).toBe(false); // not fetched yet
    await user.click(screen.getByRole("tab", { name: "Guide" }));
    expect(await screen.findByRole("heading", { name: /internal advisor notes/i })).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/maintenance/guide")).toBe(true);
    expect(screen.getByText(/internal — not printed/i)).toBeInTheDocument();
  });
});
