import { describe, it, expect } from "vitest";
import {
  SERVICE_RAIL_KEY,
  SERVICE_SCOPE,
  SERVICE_SCOPE_TITLE,
  gameScope,
  inquiryBelongsToScope,
  scopeBasePath,
  scopeForGameId,
  scopeGameId,
} from "@/lib/inbox-scope";

describe("inbox scope", () => {
  it("builds the base path for a game and for the service inbox", () => {
    expect(scopeBasePath(gameScope("g1"))).toBe("/games/g1");
    expect(scopeBasePath(SERVICE_SCOPE)).toBe("/service");
  });

  it("maps a scope to the game_id value used in queries", () => {
    expect(scopeGameId(gameScope("g1"))).toBe("g1");
    expect(scopeGameId(SERVICE_SCOPE)).toBeNull();
  });

  it("derives a scope from an inquiry row's game_id", () => {
    expect(scopeForGameId("g1")).toEqual({ kind: "game", gameId: "g1" });
    expect(scopeForGameId(null)).toEqual({ kind: "service" });
  });

  it("checks whether an inquiry belongs to a scope", () => {
    expect(inquiryBelongsToScope(gameScope("g1"), "g1")).toBe(true);
    expect(inquiryBelongsToScope(gameScope("g1"), "g2")).toBe(false);
    expect(inquiryBelongsToScope(gameScope("g1"), null)).toBe(false);
    expect(inquiryBelongsToScope(SERVICE_SCOPE, null)).toBe(true);
    expect(inquiryBelongsToScope(SERVICE_SCOPE, "g1")).toBe(false);
  });

  it("exposes the rail key and title used by the game rail", () => {
    expect(SERVICE_RAIL_KEY).toBe("service");
    expect(SERVICE_SCOPE_TITLE).toBe("서비스 문의");
  });
});
