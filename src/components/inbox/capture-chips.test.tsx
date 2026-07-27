// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CaptureChip } from "@/domain/capture/parser";

import { CaptureChips } from "./capture-chips";

const chips: CaptureChip[] = [
  { kind: "date", label: "Tue, Jul 28", value: "2026-07-28", start: 0, end: 8 },
  { kind: "time", label: "3:00 PM", value: "15:00", start: 9, end: 15 },
];

describe("CaptureChips", () => {
  it("renders each detected value with an accessible remove control", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<CaptureChips chips={chips} onRemove={onRemove} />);

    expect(
      screen.getByRole("list", { name: "Detected details" }),
    ).toHaveTextContent("Tue, Jul 28");

    // Each chip's remove button names the value it drops, so a screen-reader
    // user knows exactly what correcting it will do.
    await user.click(
      screen.getByRole("button", { name: "Remove time 3:00 PM" }),
    );
    expect(onRemove).toHaveBeenCalledWith("time");
  });

  it("renders nothing when there is nothing to correct", () => {
    const { container } = render(
      <CaptureChips chips={[]} onRemove={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
