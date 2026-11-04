import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/games/[gameId]/route";
import * as supabaseModule from "@/lib/supabase";
import * as requireAdminSessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));

function mockClient(result: { data: unknown; error: { message: string } | null }) {
  const eq = vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(result) })) }));
  const update = vi.fn(() => ({ eq }));
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from: vi.fn(() => ({ update })) } as never);
  return { update, eq };
}

function request(payload: unknown) {
  return new Request("http://localhost/api/games/game-1", { method: "PATCH", body: JSON.stringify(payload) });
}

const params = { params: { gameId: "game-1" } };

describe("PATCH /api/games/[gameId] (subtitle)", () => {
  beforeEach(() => {
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await PATCH(request({ subtitle: "x" }), params)).status).toBe(401);
  });

  it("saves the trimmed subtitle for this game", async () => {
    const { update, eq } = mockClient({ data: { id: "game-1" }, error: null });
    const response = await PATCH(request({ subtitle: "  방치형 판타지 수집 RPG " }), params);
    expect(await response.json()).toEqual({ success: true, subtitle: "방치형 판타지 수집 RPG" });
    expect(update).toHaveBeenCalledWith({ subtitle: "방치형 판타지 수집 RPG" });
    expect(eq).toHaveBeenCalledWith("id", "game-1");
  });

  it("stores an empty subtitle as null", async () => {
    const { update } = mockClient({ data: { id: "game-1" }, error: null });
    await PATCH(request({ subtitle: "   " }), params);
    expect(update).toHaveBeenCalledWith({ subtitle: null });
  });

  it("rejects a missing or too long subtitle", async () => {
    mockClient({ data: { id: "game-1" }, error: null });
    expect((await PATCH(request({}), params)).status).toBe(400);
    expect((await PATCH(request({ subtitle: "가".repeat(101) }), params)).status).toBe(400);
  });

  it("returns 404 for an unknown game and 500 when the update fails", async () => {
    mockClient({ data: null, error: null });
    expect((await PATCH(request({ subtitle: "x" }), params)).status).toBe(404);
    mockClient({ data: null, error: { message: "column games.subtitle does not exist" } });
    expect((await PATCH(request({ subtitle: "x" }), params)).status).toBe(500);
  });
});
