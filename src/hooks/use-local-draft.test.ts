// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLocalDraft } from "./use-local-draft";

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLocalDraft", () => {
  it("persists edits to localStorage after an idle delay", () => {
    const { result } = renderHook(() => useLocalDraft("sample", "", 400));

    act(() => result.current.setValue("in progress"));
    // Not yet written — typing must not wait on storage.
    expect(window.localStorage.getItem("rails:draft:sample")).toBeNull();

    act(() => vi.advanceTimersByTime(400));
    expect(window.localStorage.getItem("rails:draft:sample")).toBe(
      "in progress",
    );
  });

  it("restores a saved draft on mount", () => {
    window.localStorage.setItem("rails:draft:sample", "recovered text");

    const { result } = renderHook(() => useLocalDraft("sample", "", 400));

    expect(result.current.value).toBe("recovered text");
  });

  it("prefers a supplied seed over any saved draft", () => {
    window.localStorage.setItem("rails:draft:sample", "old draft");

    const { result } = renderHook(() => useLocalDraft("sample", "seeded", 400));

    expect(result.current.value).toBe("seeded");
  });

  it("clear removes the persisted draft", () => {
    const { result } = renderHook(() => useLocalDraft("sample", "", 400));

    act(() => result.current.setValue("temporary"));
    act(() => vi.advanceTimersByTime(400));
    expect(window.localStorage.getItem("rails:draft:sample")).toBe("temporary");

    act(() => result.current.clear());
    expect(window.localStorage.getItem("rails:draft:sample")).toBeNull();
  });
});
