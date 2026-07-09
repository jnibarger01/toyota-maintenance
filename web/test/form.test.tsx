import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { installFetchMock } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

async function toDetails(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "2020" }));
  await user.click(await screen.findByRole("button", { name: "4RUNNER" }));
  await screen.findByRole("heading", { name: /vehicle details/i });
}

describe("form validation", () => {
  it("disables Show Details until drivetrain + condition are selected, with demo defaults filled", async () => {
    installFetchMock(vi);
    const user = userEvent.setup();
    await toDetails(user);

    const submit = screen.getByRole("button", { name: /show details/i });
    expect(submit).toBeDisabled();

    // Demo defaults (dev/demo only) are pre-filled.
    expect(screen.getByLabelText(/current mileage/i)).toHaveValue("70000");
    expect(screen.getByLabelText(/avg monthly mileage/i)).toHaveValue("833");

    // Single-option dimensions auto-filled; multi-option chips required.
    expect(screen.getByLabelText(/^engine$/i)).toHaveValue("V6");
    await user.click(screen.getByRole("button", { name: "4WD" }));
    expect(submit).toBeDisabled(); // condition still missing
    await user.click(screen.getByRole("button", { name: "Normal" }));
    expect(submit).toBeEnabled();
    expect(screen.getByRole("button", { name: "Normal" })).toHaveAttribute("aria-pressed", "true");
  });

  it("invalid mileage disables submission again", async () => {
    installFetchMock(vi);
    const user = userEvent.setup();
    await toDetails(user);
    await user.click(screen.getByRole("button", { name: "4WD" }));
    await user.click(screen.getByRole("button", { name: "Normal" }));

    const mileage = screen.getByLabelText(/current mileage/i);
    await user.clear(mileage);
    expect(screen.getByRole("button", { name: /show details/i })).toBeDisabled();
    await user.type(mileage, "72500");
    expect(screen.getByRole("button", { name: /show details/i })).toBeEnabled();
  });
});
