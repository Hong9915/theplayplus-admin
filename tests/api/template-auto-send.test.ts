import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/templates/[id]/route";
import * as supabaseModule from "@/lib/supabase";
import * as templatesModule from "@/lib/templates";
import * as sessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/templates", () => ({ deleteTemplate: vi.fn(), setTemplateAutoSend: vi.fn(), updateTemplate: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/templates/tpl-1", { method: "PATCH", body: JSON.stringify(body) });
}

describe("PATCH /api/templates/[id]", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset().mockReturnValue({} as never);
    vi.mocked(templatesModule.setTemplateAutoSend).mockReset().mockResolvedValue(true);
    vi.mocked(templatesModule.updateTemplate).mockReset().mockResolvedValue(true);
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
  });

  it("edits title, content, and type when the body carries them", async () => {
    const response = await PATCH(patchRequest({ title: "새 제목", content: "새 본문", typeKey: "refund" }), { params: { id: "tpl-1" } });

    expect(templatesModule.updateTemplate).toHaveBeenCalledWith(expect.anything(), "tpl-1", {
      title: "새 제목",
      content: "새 본문",
      typeKey: "refund",
    });
    expect(templatesModule.setTemplateAutoSend).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("rejects an edit with a blank title or content", async () => {
    const response = await PATCH(patchRequest({ title: "  ", content: "본문", typeKey: null }), { params: { id: "tpl-1" } });
    expect(response.status).toBe(400);
    expect(templatesModule.updateTemplate).not.toHaveBeenCalled();
  });

  it("returns 500 when the edit fails", async () => {
    vi.mocked(templatesModule.updateTemplate).mockResolvedValue(false);
    const response = await PATCH(patchRequest({ title: "t", content: "c", typeKey: null }), { params: { id: "tpl-1" } });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ success: false, error: "update_failed" });
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    const response = await PATCH(patchRequest({ autoSend: true }), { params: { id: "tpl-1" } });
    expect(response.status).toBe(401);
    expect(templatesModule.setTemplateAutoSend).not.toHaveBeenCalled();
  });

  it("rejects a body without a boolean autoSend", async () => {
    const response = await PATCH(patchRequest({ autoSend: "yes" }), { params: { id: "tpl-1" } });
    expect(response.status).toBe(400);
    expect(templatesModule.setTemplateAutoSend).not.toHaveBeenCalled();
  });

  it("turns auto send on or off for the template", async () => {
    const response = await PATCH(patchRequest({ autoSend: true }), { params: { id: "tpl-1" } });
    expect(templatesModule.setTemplateAutoSend).toHaveBeenCalledWith(expect.anything(), "tpl-1", true);
    await expect(response.json()).resolves.toEqual({ success: true });

    await PATCH(patchRequest({ autoSend: false }), { params: { id: "tpl-1" } });
    expect(templatesModule.setTemplateAutoSend).toHaveBeenLastCalledWith(expect.anything(), "tpl-1", false);
  });

  it("returns 500 when the update fails", async () => {
    vi.mocked(templatesModule.setTemplateAutoSend).mockResolvedValue(false);
    const response = await PATCH(patchRequest({ autoSend: true }), { params: { id: "tpl-1" } });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ success: false, error: "update_failed" });
  });
});
