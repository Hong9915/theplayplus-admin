// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePersistedBoolean } from "@/components/ui/usePersistedBoolean";

describe("usePersistedBoolean", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts at the given initial value when nothing is stored", () => {
    const { result } = renderHook(() => usePersistedBoolean("k1", false));
    expect(result.current[0]).toBe(false);
  });

  it("restores a stored value after mount", () => {
    window.localStorage.setItem("k2", "true");
    const { result } = renderHook(() => usePersistedBoolean("k2", false));
    expect(result.current[0]).toBe(true);
  });

  it("updates the value and persists it", () => {
    const { result } = renderHook(() => usePersistedBoolean("k3", false));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem("k3")).toBe("true");
  });
});
