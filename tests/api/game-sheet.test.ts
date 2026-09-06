import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/games/[gameId]/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as sheetsModule from "@/lib/sheets";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn(), getAdminSession: vi.fn() }));
vi.mock("@/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheets")>();
  return { ...actual, serviceAccountEmail: vi.fn(() => "bot@proj.iam.gserviceaccount.com") };
});

function request(body: unknown) {
  return new Request("http://localhost/api/games/g1", { method: "PATCH", body: JSON.stringify(body) });
}

function mockUpdate(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from: vi.fn(() => ({ update })) } as never);
  return { update, eq };
}

describe("PATCH /api/games/[gameId]", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    const response = await PATCH(request({ sheetUrl: "x" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(401);
  });

  it("rejects an unparsable url", async () => {
    const response = await PATCH(request({ sheetUrl: "https://example.com" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "invalid_input" });
  });

  it("stores the sheet id and returns the service account email", async () => {
    const { update, eq } = mockUpdate({ data: { id: "g1" }, error: null });
    const response = await PATCH(request({ sheetUrl: "https://docs.google.com/spreadsheets/d/1AbC/edit" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, sheetId: "1AbC", serviceAccountEmail: "bot@proj.iam.gserviceaccount.com" });
    expect(update).toHaveBeenCalledWith({ sheet_id: "1AbC" });
    expect(eq).toHaveBeenCalledWith("id", "g1");
  });

  it("returns 404 when the game does not exist", async () => {
    mockUpdate({ data: null, error: { code: "PGRST116", message: "no rows" } });
    const response = await PATCH(request({ sheetUrl: "1AbC" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(404);
  });
});
