import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/games/[gameId]/lounge/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as connectModule from "@/lib/lounge-connect";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/lounge-connect", () => ({ connectLounge: vi.fn() }));

function mockGame(found: boolean) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: found ? { id: "g1" } : null, error: null });
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) } as never);
}
const call = (body: unknown) =>
  PATCH(new Request("https://admin.example/api/games/g1/lounge", { method: "PATCH", body: JSON.stringify(body) }), { params: { gameId: "g1" } });

describe("PATCH /api/games/{gameId}/lounge", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(true);
    vi.mocked(connectModule.connectLounge).mockReset();
    mockGame(true);
  });

  it("requires an admin session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await call({ loungeUrl: "Abc" })).status).toBe(401);
  });
  it("rejects a body without loungeUrl", async () => {
    expect((await call({})).status).toBe(400);
  });
  it("404s for an unknown game", async () => {
    mockGame(false);
    expect((await call({ loungeUrl: "Abc" })).status).toBe(404);
  });
  it("connects and returns the lounge id", async () => {
    vi.mocked(connectModule.connectLounge).mockResolvedValue({ ok: true, loungeId: "Abc" });
    const response = await call({ loungeUrl: "https://game.naver.com/lounge/Abc/home" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, loungeId: "Abc" });
    expect(connectModule.connectLounge).toHaveBeenCalledWith(expect.anything(), "g1", "https://game.naver.com/lounge/Abc/home");
  });
  it("maps connect errors to 400 and 500", async () => {
    vi.mocked(connectModule.connectLounge).mockResolvedValue({ ok: false, error: "lounge_unreachable" });
    const bad = await call({ loungeUrl: "Nope" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("lounge_unreachable");
    vi.mocked(connectModule.connectLounge).mockResolvedValue({ ok: false, error: "save_failed" });
    expect((await call({ loungeUrl: "Abc" })).status).toBe(500);
  });
});
