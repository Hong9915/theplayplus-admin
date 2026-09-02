import { describe, it, expect } from "vitest";
import { buildGameLogoPath } from "@/lib/storage";

// Supabase Storage rejects object keys containing non-ASCII characters with
// "Invalid key", so every generated path must stay inside a safe ASCII subset.
const SAFE_KEY = /^[A-Za-z0-9/_.-]+$/;

describe("buildGameLogoPath", () => {
  it("keeps a plain ascii filename readable", () => {
    const path = buildGameLogoPath("game-1", "logo.png", "abc123");
    expect(path).toBe("game-1/abc123-logo.png");
    expect(path).toMatch(SAFE_KEY);
  });

  it("produces a safe key for a korean filename", () => {
    const path = buildGameLogoPath("game-1", "여신로고.png", "abc123");
    expect(path).toMatch(SAFE_KEY);
    expect(path).toBe("game-1/abc123-logo.png");
  });

  it("keeps the extension while dropping unsafe characters from the base name", () => {
    const path = buildGameLogoPath("game-1", "여신 키우기 로고 (최종).PNG", "abc123");
    expect(path).toMatch(SAFE_KEY);
    expect(path.endsWith(".png")).toBe(true);
  });

  it("replaces spaces and repeated separators with single hyphens", () => {
    expect(buildGameLogoPath("game-1", "my   cool  logo.svg", "u1")).toBe("game-1/u1-my-cool-logo.svg");
  });

  it("falls back to a generic base name when nothing safe survives", () => {
    expect(buildGameLogoPath("game-1", "한글.jpeg", "u1")).toBe("game-1/u1-logo.jpeg");
  });

  it("handles a filename with no extension", () => {
    const path = buildGameLogoPath("game-1", "로고", "u1");
    expect(path).toBe("game-1/u1-logo");
    expect(path).toMatch(SAFE_KEY);
  });

  it("ignores an unsafe or overlong extension", () => {
    const path = buildGameLogoPath("game-1", "logo.한글확장자", "u1");
    expect(path).toBe("game-1/u1-logo");
    expect(path).toMatch(SAFE_KEY);
  });

  it("truncates a very long base name", () => {
    const path = buildGameLogoPath("game-1", `${"a".repeat(200)}.png`, "u1");
    expect(path.length).toBeLessThan(80);
    expect(path).toMatch(SAFE_KEY);
  });
});
