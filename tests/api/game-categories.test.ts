import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as createGroupRoute } from "@/app/api/games/[gameId]/categories/groups/route";
import { DELETE as deleteGroupRoute, PATCH as patchGroupRoute } from "@/app/api/games/[gameId]/categories/groups/[groupId]/route";
import { POST as createTypeRoute } from "@/app/api/games/[gameId]/categories/types/route";
import { DELETE as deleteTypeRoute, PATCH as patchTypeRoute } from "@/app/api/games/[gameId]/categories/types/[typeId]/route";
import { PUT as orderRoute } from "@/app/api/games/[gameId]/categories/order/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as settingsModule from "@/lib/category-settings";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/category-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/category-settings")>();
  return {
    ...actual,
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    createType: vi.fn(),
    updateType: vi.fn(),
    deleteType: vi.fn(),
    saveOrder: vi.fn(),
  };
});

const FLAGS = {
  requiresGameAccount: true,
  requiresCompanyName: false,
  allowAttachments: true,
  requiresAttachments: false,
  collectsPaymentNo: false,
  collectsOccurredAt: true,
  collectsDeviceInfo: false,
  collectsStore: true,
  collectsCharacter: true,
};

function request(method: string, payload?: unknown) {
  return new Request("http://localhost/api", { method, body: payload === undefined ? undefined : JSON.stringify(payload) });
}

const game = { params: { gameId: "game-1" } };

describe("game category routes", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset().mockReturnValue({} as never);
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    for (const fn of ["createGroup", "updateGroup", "deleteGroup", "createType", "updateType", "deleteType", "saveOrder"] as const) {
      vi.mocked(settingsModule[fn]).mockReset().mockResolvedValue({ ok: true });
    }
  });

  it("rejects unauthenticated requests on every route", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    const responses = await Promise.all([
      createGroupRoute(request("POST", {}), game),
      patchGroupRoute(request("PATCH", {}), { params: { gameId: "game-1", groupId: "g" } }),
      deleteGroupRoute(request("DELETE"), { params: { gameId: "game-1", groupId: "g" } }),
      createTypeRoute(request("POST", {}), game),
      patchTypeRoute(request("PATCH", {}), { params: { gameId: "game-1", typeId: "t" } }),
      deleteTypeRoute(request("DELETE"), { params: { gameId: "game-1", typeId: "t" } }),
      orderRoute(request("PUT", {}), game),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401, 401]);
    expect(settingsModule.deleteType).not.toHaveBeenCalled();
  });

  it("returns the invalid field for a bad key", async () => {
    const response = await createGroupRoute(request("POST", { key: "Bad Key", labelKo: "x" }), game);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "invalid_input", fields: ["key"] });
    expect(settingsModule.createGroup).not.toHaveBeenCalled();
  });

  it("creates a group for the game in the URL", async () => {
    const response = await createGroupRoute(request("POST", { key: "event", labelKo: "이벤트", labelZh: "", labelEn: "Event" }), game);
    expect(response.status).toBe(200);
    expect(settingsModule.createGroup).toHaveBeenCalledWith(expect.anything(), "game-1", { key: "event", labelKo: "이벤트", labelZh: null, labelEn: "Event" });
  });

  it("maps a taken key to 409", async () => {
    vi.mocked(settingsModule.createType).mockResolvedValue({ ok: false, error: "key_taken" });
    const response = await createTypeRoute(request("POST", { groupId: "g", key: "refund", labelKo: "환불", ...FLAGS, defaultPriority: "urgent" }), game);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("key_taken");
  });

  it("rejects 첨부 필수 without 첨부 허용 on update", async () => {
    const response = await patchTypeRoute(
      request("PATCH", { groupId: "g", labelKo: "x", ...FLAGS, allowAttachments: false, requiresAttachments: true, defaultPriority: "normal" }),
      { params: { gameId: "game-1", typeId: "t" } }
    );
    expect(response.status).toBe(400);
    expect((await response.json()).fields).toContain("requiresAttachments");
  });

  it("passes the type update through without a key", async () => {
    const response = await patchTypeRoute(
      request("PATCH", { groupId: "g", key: "sneaky", labelKo: "x", ...FLAGS, defaultPriority: "low" }),
      { params: { gameId: "game-1", typeId: "t" } }
    );
    expect(response.status).toBe(200);
    const input = vi.mocked(settingsModule.updateType).mock.calls[0][3];
    expect(input).not.toHaveProperty("key");
    expect(input).toMatchObject({ collectsCharacter: true, collectsOccurredAt: true, defaultPriority: "low" });
  });

  it("explains why a type in use cannot be deleted", async () => {
    vi.mocked(settingsModule.deleteType).mockResolvedValue({ ok: false, error: "in_use", message: "삭제할 수 없습니다" });
    const response = await deleteTypeRoute(request("DELETE"), { params: { gameId: "game-1", typeId: "t" } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: "in_use", message: "삭제할 수 없습니다" });
  });

  it("returns 404 for a group outside the game", async () => {
    vi.mocked(settingsModule.deleteGroup).mockResolvedValue({ ok: false, error: "not_found" });
    const response = await deleteGroupRoute(request("DELETE"), { params: { gameId: "game-1", groupId: "elsewhere" } });
    expect(response.status).toBe(404);
  });

  it("returns 500 when loading the categories throws", async () => {
    vi.mocked(settingsModule.updateGroup).mockRejectedValue(new Error("db down"));
    const response = await patchGroupRoute(request("PATCH", { labelKo: "x" }), { params: { gameId: "game-1", groupId: "g" } });
    expect(response.status).toBe(500);
  });

  it("validates and saves the order", async () => {
    expect((await orderRoute(request("PUT", { groups: "nope" }), game)).status).toBe(400);
    vi.mocked(settingsModule.saveOrder).mockResolvedValue({ ok: false, error: "order_mismatch" });
    const response = await orderRoute(request("PUT", { groups: [{ id: "g", typeIds: ["t"] }] }), game);
    expect(response.status).toBe(409);
    expect(settingsModule.saveOrder).toHaveBeenCalledWith(expect.anything(), "game-1", { groups: [{ id: "g", typeIds: ["t"] }] });
  });
});
