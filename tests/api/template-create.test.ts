import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/games/[gameId]/templates/route";
import * as supabaseModule from "@/lib/supabase";
import * as templatesModule from "@/lib/templates";
import * as sessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/templates", () => ({ createTemplate: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));

function postRequest(body: unknown) {
  return new Request("http://localhost/api/games/game-1/templates", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validBody = { typeKey: "payment_refund", title: "환불 안내", content: "환불 절차입니다." };

describe("POST /api/games/[gameId]/templates", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset().mockReturnValue({} as never);
    vi.mocked(templatesModule.createTemplate).mockReset().mockResolvedValue(true);
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);

    const response = await POST(postRequest(validBody), { params: { gameId: "game-1" } });

    expect(response.status).toBe(401);
    expect(templatesModule.createTemplate).not.toHaveBeenCalled();
  });

  it("creates the template", async () => {
    const response = await POST(postRequest(validBody), { params: { gameId: "game-1" } });

    expect(templatesModule.createTemplate).toHaveBeenCalledWith(expect.anything(), {
      gameId: "game-1",
      typeKey: "payment_refund",
      title: "환불 안내",
      content: "환불 절차입니다.",
    });
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("accepts a null typeKey as a shared template", async () => {
    await POST(postRequest({ ...validBody, typeKey: null }), { params: { gameId: "game-1" } });

    expect(templatesModule.createTemplate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ typeKey: null })
    );
  });

  it("rejects a blank title or content", async () => {
    const blankTitle = await POST(postRequest({ ...validBody, title: "  " }), {
      params: { gameId: "game-1" },
    });
    expect(blankTitle.status).toBe(400);

    const blankContent = await POST(postRequest({ ...validBody, content: "" }), {
      params: { gameId: "game-1" },
    });
    expect(blankContent.status).toBe(400);
    expect(templatesModule.createTemplate).not.toHaveBeenCalled();
  });

  it("returns 500 when the insert fails", async () => {
    vi.mocked(templatesModule.createTemplate).mockResolvedValue(false);

    const response = await POST(postRequest(validBody), { params: { gameId: "game-1" } });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ success: false, error: "save_failed" });
  });
});
