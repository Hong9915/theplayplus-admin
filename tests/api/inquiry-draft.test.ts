import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT } from "@/app/api/inquiries/[id]/draft/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ getAdminSession: vi.fn() }));

function putRequest(body: unknown) {
  return new Request("http://localhost/api/inquiries/inq-1/draft", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

function mockClient(updateError: { message: string } | null = null) {
  const eq = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
  return { update, eq };
}

describe("PUT /api/inquiries/[id]/draft", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
    vi.mocked(sessionModule.getAdminSession)
      .mockReset()
      .mockResolvedValue({ id: "user-1", email: "info@theplayplus.com" });
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(sessionModule.getAdminSession).mockResolvedValue(null);

    const response = await PUT(putRequest({ draftReply: "초안" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ success: false, error: "unauthorized" });
  });

  it("saves the draft", async () => {
    const { update, eq } = mockClient();

    const response = await PUT(putRequest({ draftReply: "작성 중인 답변" }), { params: { id: "inq-1" } });

    expect(update).toHaveBeenCalledWith({ draft_reply: "작성 중인 답변" });
    expect(eq).toHaveBeenCalledWith("id", "inq-1");
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("clears the draft when given an empty string", async () => {
    const { update } = mockClient();

    await PUT(putRequest({ draftReply: "" }), { params: { id: "inq-1" } });

    expect(update).toHaveBeenCalledWith({ draft_reply: null });
  });

  it("rejects a non-string draft", async () => {
    const response = await PUT(putRequest({ draftReply: 42 }), { params: { id: "inq-1" } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, error: "invalid_draft" });
  });

  it("returns 500 when the update fails", async () => {
    mockClient({ message: "db error" });

    const response = await PUT(putRequest({ draftReply: "초안" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(500);
  });
});
