import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE } from "@/app/api/templates/[id]/route";
import * as supabaseModule from "@/lib/supabase";
import * as templatesModule from "@/lib/templates";
import * as sessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/templates", () => ({ deleteTemplate: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));

function deleteRequest() {
  return new Request("http://localhost/api/templates/tpl-1", { method: "DELETE" });
}

describe("DELETE /api/templates/[id]", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset().mockReturnValue({} as never);
    vi.mocked(templatesModule.deleteTemplate).mockReset().mockResolvedValue(true);
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);

    const response = await DELETE(deleteRequest(), { params: { id: "tpl-1" } });

    expect(response.status).toBe(401);
    expect(templatesModule.deleteTemplate).not.toHaveBeenCalled();
  });

  it("deletes the template", async () => {
    const response = await DELETE(deleteRequest(), { params: { id: "tpl-1" } });

    expect(templatesModule.deleteTemplate).toHaveBeenCalledWith(expect.anything(), "tpl-1");
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("returns 500 when the delete fails", async () => {
    vi.mocked(templatesModule.deleteTemplate).mockResolvedValue(false);

    const response = await DELETE(deleteRequest(), { params: { id: "tpl-1" } });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ success: false, error: "delete_failed" });
  });
});
