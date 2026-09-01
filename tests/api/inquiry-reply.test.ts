import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/reply/route";
import * as supabaseModule from "@/lib/supabase";
import * as gmailModule from "@/lib/gmail";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/gmail", () => ({
  sendReplyEmail: vi.fn(),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/inquiries/inq-1/reply", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/inquiries/[id]/reply", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
    vi.mocked(gmailModule.sendReplyEmail).mockReset();
  });

  function mockFetchInquiry(inquiry: { id: string; reply_email: string; title: string } | null, error: { message: string } | null = null) {
    const single = vi.fn().mockResolvedValue({ data: inquiry, error });
    const eqSelect = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq: eqSelect }));
    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: eqUpdate }));
    const from = vi.fn(() => ({ select, update }));
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
    return { update, eqUpdate };
  }

  it("sends the email and marks the inquiry resolved on success", async () => {
    const { update, eqUpdate } = mockFetchInquiry({ id: "inq-1", reply_email: "user@example.com", title: "제목" });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(undefined);

    const response = await POST(jsonRequest({ replyContent: "답변 내용입니다" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(gmailModule.sendReplyEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      subject: "Re: 제목",
      body: "답변 내용입니다",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "resolved", reply_content: "답변 내용입니다" })
    );
    expect(eqUpdate).toHaveBeenCalledWith("id", "inq-1");
    expect(json).toEqual({ success: true });
  });

  it("rejects an empty reply", async () => {
    mockFetchInquiry({ id: "inq-1", reply_email: "user@example.com", title: "제목" });
    const response = await POST(jsonRequest({ replyContent: "" }), { params: { id: "inq-1" } });
    expect(response.status).toBe(400);
    expect(gmailModule.sendReplyEmail).not.toHaveBeenCalled();
  });

  it("returns 404 when the inquiry does not exist", async () => {
    mockFetchInquiry(null, { message: "not found" });
    const response = await POST(jsonRequest({ replyContent: "답변" }), { params: { id: "missing" } });
    expect(response.status).toBe(404);
  });

  it("returns 500 and does not update status when the email send fails", async () => {
    const { update } = mockFetchInquiry({ id: "inq-1", reply_email: "user@example.com", title: "제목" });
    vi.mocked(gmailModule.sendReplyEmail).mockRejectedValue(new Error("gmail down"));

    const response = await POST(jsonRequest({ replyContent: "답변 내용입니다" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(500);
    expect(update).not.toHaveBeenCalled();
  });
});
