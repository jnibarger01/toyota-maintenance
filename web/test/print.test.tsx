import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { PrintSheet } from "../src/components/PrintSheet";
import { installFetchMock, lookupResult, HASH } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("print button behavior", () => {
  it("Print triggers window.print from the results view", async () => {
    installFetchMock(vi);
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "2020" }));
    await user.click(await screen.findByRole("button", { name: "4RUNNER" }));
    await screen.findByRole("heading", { name: /vehicle details/i });
    await user.click(screen.getByRole("button", { name: "4WD" }));
    await user.click(screen.getByRole("button", { name: "Normal" }));
    await user.click(screen.getByRole("button", { name: /show details/i }));
    await screen.findByRole("heading", { name: /2020 TOYOTA 4RUNNER/i });

    await user.click(screen.getByRole("button", { name: /^print$/i }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });
});

describe("print sheet content", () => {
  it("renders the customer sheet from a lookup result", () => {
    const { container } = render(<PrintSheet result={lookupResult} />);
    const text = container.textContent ?? "";

    expect(text).toContain("Hendrick Toyota Merriam");      // dealership branding
    expect(screen.getByAltText("Hendrick Automotive Group™")).toBeInTheDocument();
    expect(text).toContain("Service Department");           // dealership/advisor header placeholder
    expect(text).toContain("Advisor:");
    expect(text).toContain("2020 TOYOTA 4RUNNER SR5");      // vehicle
    expect(text).toContain("70,000 miles");                 // current mileage
    expect(text).toContain("Normal");                       // driving condition
    expect(text).toContain("Due at 70,000 miles");          // due-now group
    expect(text).toContain("Replace engine oil and oil filter");
    expect(text).toContain("Rotate tires (TIRE ROT)");      // Toyota name + advisor label
    expect(text).toContain("$29.95");                       // explicitly mapped price only
    expect(text).toContain("Next service milestone");
    expect(text).toContain("75,000 miles");
    expect(text).toContain("about 7 months");
    expect(text).toContain("Advisor notes");
    expect(text).toContain("Schedule ref 317848a5f5 / 7d807a092e"); // short footer reference
  });

  it("does not show developer-only or internal data", () => {
    const { container } = render(<PrintSheet result={lookupResult} />);
    const text = container.textContent ?? "";

    expect(text).not.toContain("27T");            // op codes are internal
    expect(text).not.toContain("0.3");            // labor hours are internal
    expect(text).not.toContain(HASH);             // never the full hash
    expect(text).not.toContain(lookupResult.source.config_key); // never the full config key
    expect(text).not.toMatch(/[{}]/);             // no raw JSON
    expect(text).not.toMatch(/task_key|schedule_json|customer_visible/);
  });
});
