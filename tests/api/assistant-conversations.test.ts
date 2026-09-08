import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/assistant/conversations/route";
import { DELETE } from "@/app/api/assistant/conversations/[id]/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as storeModule from "@/lib/assistant-store";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn(() => ({})) }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn(), getAdminSession: vi.fn() }));
vi.mock("@/lib/assistant-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant-store")>();
  return { ...actual, createConversation: vi.fn(), deleteConversation: vi.fn() };
});

const conversation = { id: "c1", gameId: "g1", title: "VIP 확인", createdBy: "a@b", createdAt: "", updatedAt: "" };

describe("POST /api/assistant/conversations", () => {
  beforeEach(() => {
    process.env.ASSISTANT_CHAT_ENABLED = "1";
    vi.mocked(sessionModule.getAdminSession).mockReset().mockResolvedValue({ id: "u1", email: "a@b" });
    vi.mocked(storeModule.createConversation).mockReset().mockResolvedValue(conversation);
  });

  function request(body: unknown) {
    return new Request("http://localhost/api/assistant/conversations", { method: "POST", body: JSON.stringify(body) });
  }

  afterEach(() => {
    delete process.env.ASSISTANT_CHAT_ENABLED;
  });

  it("returns 404 assistant_chat_disabled when the chat flag is off, before touching the session", async () => {
    delete process.env.ASSISTANT_CHAT_ENABLED;
    const response = await POST(request({ gameId: "g1", message: "안녕" }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ success: false, error: "assistant_chat_disabled" });
    expect(sessionModule.getAdminSession).not.toHaveBeenCalled();
    expect(storeModule.createConversation).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.getAdminSession).mockResolvedValue(null);
    expect((await POST(request({ gameId: "g1", firstMessage: "x" }))).status).toBe(401);
  });

  it("rejects a missing gameId", async () => {
    expect((await POST(request({ firstMessage: "x" }))).status).toBe(400);
  });

  it("rejects a JSON body that is the literal null", async () => {
    const req = new Request("http://localhost/api/assistant/conversations", { method: "POST", body: "null" });
    expect((await POST(req)).status).toBe(400);
    expect(storeModule.createConversation).not.toHaveBeenCalled();
  });

  it("creates a conversation titled from the first message", async () => {
    const response = await POST(request({ gameId: "g1", firstMessage: "  52009 VIP 몇이야  " }));
    expect(await response.json()).toEqual({ success: true, conversationId: "c1" });
    expect(storeModule.createConversation).toHaveBeenCalledWith(expect.anything(), { gameId: "g1", title: "52009 VIP 몇이야", createdBy: "a@b" });
  });

  it("returns 500 when the insert fails", async () => {
    vi.mocked(storeModule.createConversation).mockResolvedValue(null);
    expect((await POST(request({ gameId: "g1", firstMessage: "x" }))).status).toBe(500);
  });
});

describe("DELETE /api/assistant/conversations/[id]", () => {
  beforeEach(() => {
    process.env.ASSISTANT_CHAT_ENABLED = "1";
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(storeModule.deleteConversation).mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    delete process.env.ASSISTANT_CHAT_ENABLED;
  });

  it("returns 404 assistant_chat_disabled when the chat flag is off", async () => {
    delete process.env.ASSISTANT_CHAT_ENABLED;
    const response = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: { id: "c1" } });
    expect(response.status).toBe(404);
    expect(storeModule.deleteConversation).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    const response = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: { id: "c1" } });
    expect(response.status).toBe(401);
    expect(storeModule.deleteConversation).not.toHaveBeenCalled();
  });

  it("deletes and returns success", async () => {
    const response = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: { id: "c1" } });
    expect(await response.json()).toEqual({ success: true });
    expect(storeModule.deleteConversation).toHaveBeenCalledWith(expect.anything(), "c1");
  });

  it("returns 500 when the delete fails", async () => {
    vi.mocked(storeModule.deleteConversation).mockResolvedValue(false);
    const response = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: { id: "c1" } });
    expect(response.status).toBe(500);
  });
});
