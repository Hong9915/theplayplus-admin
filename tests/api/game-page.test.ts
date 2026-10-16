import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT } from "@/app/api/games/[gameId]/page/route";
import * as supabaseModule from "@/lib/supabase";
import * as requireAdminSessionModule from "@/lib/require-admin-session";
import { emptyGamePage } from "@/lib/game-pages";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));

function body(overrides: Record<string, unknown> = {}) {
  const { gameId: _g, kvPath: _k, cardPath: _c, screenshotPaths: _s, updatedAt: _u, ...rest } = emptyGamePage("game-1", "여신키우기");
  return { ...rest, ...overrides };
}

function request(method: string, payload: unknown) {
  return new Request("http://localhost/api", { method, body: JSON.stringify(payload) });
}

function mockClient(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const upsert = vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue(result) })) }));
  const client = { from: vi.fn(() => ({ upsert })) };
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue(client as never);
  return { upsert };
}

const params = { params: { gameId: "game-1" } };

describe("PUT /api/games/[gameId]/page", () => {
  beforeEach(() => {
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockResolvedValue(true as never);
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockResolvedValue(false as never);
    const response = await PUT(request("PUT", body()), params);
    expect(response.status).toBe(401);
  });

  it("returns the invalid fields so the form can mark them", async () => {
    mockClient({ data: null, error: null });
    const response = await PUT(request("PUT", body({ published: true, onestoreUrl: "nope" })), params);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.fields).toEqual(expect.arrayContaining(["slug", "onestoreUrl"]));
  });

  it("upserts by game id and returns the saved page", async () => {
    const { upsert } = mockClient({
      data: { game_id: "game-1", published: true, slug: "goddess-idle", release_status: "live", sort_order: 0, title_ko: "여신키우기" },
      error: null,
    });
    const response = await PUT(request("PUT", body({ published: true, slug: "goddess-idle", releaseStatus: "live" })), params);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.page.slug).toBe("goddess-idle");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ game_id: "game-1", slug: "goddess-idle", published: true, genre_ko: null }),
      { onConflict: "game_id" }
    );
  });

  it("reports a slug another game already uses", async () => {
    mockClient({ data: null, error: { code: "23505", message: "duplicate key" } });
    const response = await PUT(request("PUT", body({ slug: "goddess-idle" })), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("slug_taken");
  });
});
