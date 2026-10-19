import { describe, it, expect } from "vitest";
import { heatLevel, HEAT_LABELS } from "@/lib/heat";

const NOW = new Date("2026-10-19T12:00:00.000Z");

function hoursAgo(n: number): string {
  return new Date(NOW.getTime() - n * 3_600_000).toISOString();
}

describe("heatLevel", () => {
  it("is fresh under 4 hours", () => {
    expect(heatLevel(hoursAgo(0), "new", NOW)).toBe("fresh");
    expect(heatLevel(hoursAgo(3.99), "in_progress", NOW)).toBe("fresh");
  });

  it("warms up from 4 hours and is hot from a day", () => {
    expect(heatLevel(hoursAgo(4), "new", NOW)).toBe("warm");
    expect(heatLevel(hoursAgo(23.9), "new", NOW)).toBe("warm");
    expect(heatLevel(hoursAgo(24), "new", NOW)).toBe("hot");
  });

  it("is stale from 72 hours, the same line as the 3일 이상 미처리 view", () => {
    expect(heatLevel(hoursAgo(71.9), "new", NOW)).toBe("hot");
    expect(heatLevel(hoursAgo(72), "new", NOW)).toBe("stale");
  });

  it("cools down once resolved, however old", () => {
    expect(heatLevel(hoursAgo(200), "resolved", NOW)).toBe("done");
  });

  it("has a label for every level", () => {
    expect(HEAT_LABELS.stale).toBe("3일 이상");
    expect(Object.keys(HEAT_LABELS)).toEqual(["fresh", "warm", "hot", "stale", "done"]);
  });
});
