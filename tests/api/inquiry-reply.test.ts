import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/reply/route";
import * as supabaseModule from "@/lib/supabase";
import * as gmailModule from "@/lib/gmail";
import * as eventsModule from "@/lib/events";
import * as requireAdminSessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/gmail", () => ({
  sendReplyEmail: vi.fn(),
}));

vi.mock("@/lib/events", () => ({ recordEvent: vi.fn() }));

vi.mock("@/lib/require-admin-session", () => ({
  requireAdminSession: vi.fn(),
  getAdminSession: vi.fn(),
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
    vi.mocked(eventsModule.recordEvent).mockReset().mockResolvedValue(undefined);
    vi.mocked(requireAdminSessionModule.getAdminSession)
      .mockReset()
      .mockResolvedValue({ id: "user-1", email: "info@theplayplus.com" });
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(requireAdminSessionModule.getAdminSession).mockResolvedValue(null);

    const response = await POST(jsonRequest({ replyContent: "답변 내용입니다" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ success: false, error: "unauthorized" });
    expect(gmailModule.sendReplyEmail).not.toHaveBeenCalled();
  });

  function mockFetchInquiry(
    inquiry: { id: string; reply_email: string; title: string; inquiry_no?: string | null } | null,
    error: { message: string } | null = null
  ) {
    const single = vi.fn().mockResolvedValue({ data: inquiry, error });
    const eqSelect = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq: eqSelect }));
    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: eqUpdate }));
    const from = vi.fn(() => ({ select, update }));
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
    return { update, eqUpdate };
  }

  it("sends the email and marks the inquiry in_progress on success", async () => {
    const { update, eqUpdate } = mockFetchInquiry({
      id: "inq-1",
      reply_email: "user@example.com",
      title: "제목",
      inquiry_no: "R-20260723-0005",
    });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(undefined);

    const response = await POST(jsonRequest({ replyContent: "답변 내용입니다" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(gmailModule.sendReplyEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      subject: "[R-20260723-0005] Re: 제목",
      body: "답변 내용입니다",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress", reply_content: "답변 내용입니다", draft_reply: null })
    );
    expect(eventsModule.recordEvent).toHaveBeenCalledWith(expect.anything(), {
      inquiryId: "inq-1",
      actor: { id: "user-1", email: "info@theplayplus.com" },
      kind: "reply_sent",
    });
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

  it("falls back to a bare subject when the inquiry has no number", async () => {
    mockFetchInquiry({ id: "inq-1", reply_email: "user@example.com", title: "제목", inquiry_no: null });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(undefined);

    await POST(jsonRequest({ replyContent: "답변" }), { params: { id: "inq-1" } });

    expect(gmailModule.sendReplyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Re: 제목" })
    );
  });

  it("still returns success when recording the event fails", async () => {
    mockFetchInquiry({ id: "inq-1", reply_email: "user@example.com", title: "제목", inquiry_no: "R-1" });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(undefined);
    vi.mocked(eventsModule.recordEvent).mockRejectedValue(new Error("boom"));

    const response = await POST(jsonRequest({ replyContent: "답변" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });
});
