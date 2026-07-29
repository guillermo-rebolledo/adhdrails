// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EnergyRightNow } from "./energy-right-now";

describe("EnergyRightNow", () => {
  it("marks the current energy as pressed and offers Not set", () => {
    render(<EnergyRightNow energy="medium" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Medium" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Low" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Not set" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("selects an energy on click", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EnergyRightNow energy={null} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "High" }));
    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("clears the selection when the active energy is toggled off", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EnergyRightNow energy="low" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Low" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("clears the selection via Not set", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EnergyRightNow energy="high" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Not set" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
