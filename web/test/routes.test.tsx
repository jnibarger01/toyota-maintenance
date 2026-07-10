import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONFIG_KEY, installFetchMock } from "./fixtures";
import { renderApp } from "./renderApp";

afterEach(() => vi.unstubAllGlobals());

describe("route-driven cockpit", () => {
  it("redirects the root and keeps year/model navigation in the URL with one grouped model card", async () => {
    installFetchMock(vi);
    const user = userEvent.setup();
    renderApp("/");

    expect(await screen.findByTestId("location")).toHaveTextContent("/cockpit");
    await user.click(await screen.findByRole("link", { name: "2020" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/cockpit/2020");
    expect(await screen.findAllByRole("link", { name: /4RUNNER/i })).toHaveLength(1);
    await user.click(screen.getByRole("link", { name: /4RUNNER/i }));
    expect(screen.getByTestId("location")).toHaveTextContent("/vehicle/2020/4runner");
    await user.click(await screen.findByRole("link", { name: /change model/i }));
    expect(screen.getByTestId("location")).toHaveTextContent("/cockpit/2020");
  });

  it("refreshes an exact configuration-key schedule from its deep link", async () => {
    const calls = installFetchMock(vi);
    renderApp(`/schedule/2020/4runner/${CONFIG_KEY}?condition=normal&mileage=70000&avgMonthlyMileage=833&view=grid`);

    expect(await screen.findByRole("heading", { name: /2020 TOYOTA 4RUNNER/i })).toBeInTheDocument();
    expect(calls.some((call) => call.url === `/api/configs/${CONFIG_KEY}`)).toBe(true);
    expect(calls.some((call) => call.url.includes("/api/maintenance/grid?") && call.url.includes("range=full"))).toBe(true);
  });

  it("supports a dimension-query schedule deep link when no config id is present", async () => {
    const calls = installFetchMock(vi);
    const search = new URLSearchParams({
      trim: "SR5",
      engine: "V6 4.0L",
      engineSize: "4.0L",
      transmission: "Automatic",
      drivetrain: "4WD",
      condition: "normal",
      mileage: "70000",
      view: "grid",
    });
    renderApp(`/schedule/2020/4runner?${search}`);

    expect(await screen.findByRole("heading", { name: /2020 TOYOTA 4RUNNER/i })).toBeInTheDocument();
    expect(calls.some((call) => call.url === "/api/models?year=2020")).toBe(true);
    expect(calls.some((call) => call.url.startsWith("/api/configs?"))).toBe(true);
  });

  it("shows a friendly recovery route for invalid path parameters", async () => {
    installFetchMock(vi);
    const invalidYear = renderApp("/vehicle/1999/not-real");
    expect(await screen.findByText(/model year must be between 2000 and 2026/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to vehicle selection/i })).toHaveAttribute("href", "/cockpit");
    invalidYear.unmount();

    renderApp(`/schedule/2020/4runner/${CONFIG_KEY}?condition=normal&mileage=70000&view=banana`);
    expect(await screen.findByText(/schedule view must be grid, list, or guide/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to vehicle selection/i })).toHaveAttribute("href", "/cockpit");
  });
});
