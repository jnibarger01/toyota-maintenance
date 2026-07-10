import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrintSheet } from "../src/components/PrintSheet";
import { gridResponse, installFetchMock, lookupResult, HASH } from "./fixtures";
import { renderApp } from "./renderApp";

afterEach(() => vi.unstubAllGlobals());

describe("print button behavior", () => {
  it("opens a visible deep-link preview before explicitly printing", async () => {
    installFetchMock(vi);
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("link", { name: /print \d+ included tasks.*open print preview/i }));
    expect(await screen.findByText("Service Department · Maintenance Review")).toBeVisible();
    await waitFor(() => expect(document.activeElement).toHaveClass("print-preview"));
    await user.click(screen.getByRole("button", { name: /print customer sheet/i }));
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
    expect(text).toContain("Scheduled at 70,000 miles");    // current interval group
    expect(text).toContain("Replace engine oil and oil filter");
    expect(text).toContain("Rotate tires (TIRE ROT)");      // Toyota task leads; service label stays secondary
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
    expect(text).not.toContain("$29.95");         // customer sheet never carries pricing
    expect(text).not.toContain("HIDDEN TASK");    // customer-hidden rows stay hidden
    expect(text).not.toContain("Hidden internal inspection");
    expect(text).not.toContain(HASH);             // never the full hash
    expect(text).not.toContain(lookupResult.source.config_key); // never the full config key
    expect(text).not.toMatch(/[{}]/);             // no raw JSON
    expect(text).not.toMatch(/task_key|schedule_json|customer_visible/);
  });

  it("prints only the ephemeral customer-safe task selection", () => {
    const { container } = render(
      <PrintSheet result={lookupResult} grid={gridResponse} includedTaskNames={["Rotate tires"]} />,
    );
    const text = container.textContent ?? "";

    expect(text).toContain("Rotate tires (TIRE ROT)");
    expect(text).not.toContain("Replace engine oil and oil filter");
    expect(text).not.toContain("Hidden internal inspection");
  });

  it("prints an honest empty-schedule message", () => {
    const empty = {
      ...lookupResult,
      intervals: [],
      mileage: {
        ...lookupResult.mileage,
        current_interval: null,
        previous_interval: null,
        next_interval: null,
      },
      due_now: [],
      overdue: [],
      upcoming: [],
    };
    const { container } = render(<PrintSheet result={empty} />);
    expect(container.textContent).toContain("No published maintenance intervals were included in this schedule.");
    expect(container.textContent).not.toContain("first scheduled service at — miles");
  });
});
