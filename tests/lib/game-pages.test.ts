import { describe, it, expect, vi, afterEach } from "vitest";
import {
  emptyGamePage,
  gamePageSchema,
  getGameSiteImageUrl,
  isStoragePath,
  mapGamePageRow,
  toGamePageColumns,
} from "@/lib/game-pages";

function input(overrides: Record<string, unknown> = {}) {
  const { gameId: _g, kvPath: _k, cardPath: _c, screenshotPaths: _s, updatedAt: _u, ...rest } = emptyGamePage("game-1", "여신키우기");
  return { ...rest, ...overrides };
}

describe("gamePageSchema", () => {
  it("accepts an unpublished page with empty fields", () => {
    expect(gamePageSchema.safeParse(input({ titleKo: "" })).success).toBe(true);
  });

  it("requires slug and Korean title to publish", () => {
    const result = gamePageSchema.safeParse(input({ published: true, titleKo: " " }));
    expect(result.success).toBe(false);
    const fields = result.success ? [] : result.error.issues.map((issue) => issue.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["slug", "titleKo"]));
  });

  it("publishes with slug and title", () => {
    expect(gamePageSchema.safeParse(input({ published: true, slug: "goddess-idle" })).success).toBe(true);
  });

  it.each(["Goddess", "goddess_idle", "-goddess", "goddess--idle", "여신"])("rejects slug %s", (slug) => {
    expect(gamePageSchema.safeParse(input({ slug })).success).toBe(false);
  });

  it("rejects store links that are not http(s)", () => {
    const result = gamePageSchema.safeParse(input({ onestoreUrl: "onesto.re/0001007974" }));
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path[0])).toEqual(["onestoreUrl"]);
  });
});

describe("toGamePageColumns / mapGamePageRow", () => {
  it("stores blank text as null and keeps the description's line breaks", () => {
    const parsed = gamePageSchema.parse(input({ slug: "goddess-idle", descriptionKo: "첫 줄\n\n◆ 소제목", genreKo: "  " }));
    const columns = toGamePageColumns(parsed);
    expect(columns.slug).toBe("goddess-idle");
    expect(columns.genre_ko).toBeNull();
    expect(columns.description_ko).toBe("첫 줄\n\n◆ 소제목");
  });

  it("maps null columns back to empty strings", () => {
    const page = mapGamePageRow({ game_id: "g", published: true, slug: "a", release_status: "live", sort_order: 2, title_ko: "제목", screenshot_paths: null });
    expect(page.titleKo).toBe("제목");
    expect(page.genreKo).toBe("");
    expect(page.screenshotPaths).toEqual([]);
    expect(page.sortOrder).toBe(2);
  });
});

describe("image paths", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("builds a public game-site URL for bucket paths", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    expect(getGameSiteImageUrl("g/1-kv.png")).toBe("https://x.supabase.co/storage/v1/object/public/game-site/g/1-kv.png");
  });

  it("leaves website public-folder paths alone and never deletes them", () => {
    expect(getGameSiteImageUrl("/games/goddess-idle/kv-wide.png")).toBe("/games/goddess-idle/kv-wide.png");
    expect(isStoragePath("/games/goddess-idle/kv-wide.png")).toBe(false);
    expect(isStoragePath("g/1-kv.png")).toBe(true);
    expect(isStoragePath(null)).toBe(false);
  });
});

describe("onestore sync", () => {
  it("needs a store link to turn on automatic sync", () => {
    const result = gamePageSchema.safeParse(input({ onestoreSync: true, onestoreUrl: "" }));
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path[0])).toEqual(["onestoreUrl"]);
  });

  it("stores the sync switch", () => {
    const parsed = gamePageSchema.parse(input({ onestoreSync: true, onestoreUrl: "https://onesto.re/0001007974" }));
    expect(toGamePageColumns(parsed).onestore_sync).toBe(true);
    expect(mapGamePageRow({ game_id: "g", release_status: "live", onestore_sync: true }).onestoreSync).toBe(true);
  });
});
