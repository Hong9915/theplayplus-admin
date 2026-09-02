import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/reply/route";
import * as supabaseModule from "@/lib/supabase";
import * as gmailModule from "@/lib/gmail";
import * as eventsModule from "@/lib/events";
import * as messagesModule from "@/lib/messages";
import * as requireAdminSessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/gmail", () => ({
  sendReplyEmail: vi.fn(),
}));

vi.mock("@/lib/events", () => ({ recordEvent: vi.fn() }));
vi.mock("@/lib/messages", () => ({ createOutboundMessage: vi.fn(), listRfcMessageIds: vi.fn() }));

vi.mock("@/lib/require-admin-session", () => ({
  requireAdminSession: vi.fn(),
  getAdminSession: vi.fn(),
}));

const SENT = { gmailMessageId: "gm-1", gmailThreadId: "thread-1", rfcMessageId: "<abc@theplayplus.com>" };

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
    vi.mocked(messagesModule.createOutboundMessage).mockReset().mockResolvedValue(true);
    vi.mocked(messagesModule.listRfcMessageIds).mockReset().mockResolvedValue([]);
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
    inquiry: {
      id: string;
      reply_email: string;
      title: string;
      content?: string;
      game_id?: string | null;
      group_key?: string;
      type_key?: string;
      game_account?: string | null;
      inquiry_no?: string | null;
      gmail_thread_id?: string | null;
    } | null,
    error: { message: string } | null = null,
    game: { name: string } | null = null
  ) {
    const row = inquiry ? { content: "문의 본문", game_id: null, group_key: "g", type_key: "t", game_account: null, ...inquiry } : null;
    const single = vi.fn().mockResolvedValue({ data: row, error });
    const eqSelect = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq: eqSelect }));
    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: eqUpdate }));

    // 메일 꾸밈용 조회: games.name, inquiry_groups/inquiry_types 라벨
    const gameSingle = vi.fn().mockResolvedValue({ data: game, error: game ? null : { message: "none" } });
    const gameSelect = vi.fn(() => ({ eq: vi.fn(() => ({ single: gameSingle })) }));
    const groupsSelect = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ data: [{ id: "grp-1", key: "g", label_ko: "게임 이용 문의" }], error: null }),
    }));
    const typesSelect = vi.fn(() => ({
      in: vi.fn().mockResolvedValue({ data: [{ key: "t", label_ko: "결제/환불" }], error: null }),
    }));

    const from = vi.fn((table: string) => {
      if (table === "games") return { select: gameSelect };
      if (table === "inquiry_groups") return { select: groupsSelect };
      if (table === "inquiry_types") return { select: typesSelect };
      return { select, update };
    });
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
    return { update, eqUpdate, from };
  }

  it("sends the email and marks the inquiry in_progress on success", async () => {
    const { update, eqUpdate } = mockFetchInquiry({
      id: "inq-1",
      reply_email: "user@example.com",
      title: "제목",
      inquiry_no: "R-20260723-0005",
    });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(SENT);

    const response = await POST(jsonRequest({ replyContent: "답변 내용입니다" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(gmailModule.sendReplyEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        subject: "[R-20260723-0005] Re: 제목",
        threadId: null,
        references: [],
      })
    );
    const sendInput = vi.mocked(gmailModule.sendReplyEmail).mock.calls[0][0];
    // 텍스트 본문은 답변이 맨 앞, 그 아래 원문 인용
    expect(sendInput.body.startsWith("답변 내용입니다")).toBe(true);
    expect(sendInput.body).toContain("접수번호: R-20260723-0005");
    expect(sendInput.body).toContain("문의 본문");
    // HTML 본문은 브랜드 템플릿 안에 답변과 원문이 들어가고 로고를 cid로 참조한다
    expect(sendInput.html).toContain("답변 내용입니다");
    expect(sendInput.html).toContain("문의 본문");
    expect(sendInput.html).toContain('src="cid:theplayplus-logo"');
    expect(sendInput.inlineImages).toEqual([
      expect.objectContaining({ cid: "theplayplus-logo", contentType: "image/png", filename: "theplayplus-logo.png" }),
    ]);
    expect(sendInput.inlineImages?.[0].data.length).toBeGreaterThan(1000);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "in_progress",
        reply_content: "답변 내용입니다",
        draft_reply: null,
        gmail_thread_id: "thread-1",
      })
    );
    expect(messagesModule.createOutboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inquiryId: "inq-1",
        author: { id: "user-1", email: "info@theplayplus.com" },
        body: "답변 내용입니다",
        gmailMessageId: "gm-1",
        rfcMessageId: "<abc@theplayplus.com>",
      })
    );
    expect(eventsModule.recordEvent).toHaveBeenCalledWith(expect.anything(), {
      inquiryId: "inq-1",
      actor: { id: "user-1", email: "info@theplayplus.com" },
      kind: "reply_sent",
    });
    expect(eqUpdate).toHaveBeenCalledWith("id", "inq-1");
    expect(json).toEqual({ success: true });
  });

  it("puts the game name, category labels, and account in the branded email", async () => {
    mockFetchInquiry(
      {
        id: "inq-1",
        reply_email: "user@example.com",
        title: "제목",
        game_id: "game-1",
        group_key: "g",
        type_key: "t",
        game_account: "mahamaster",
        inquiry_no: "R-1",
      },
      null,
      { name: "여신키우기" }
    );
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(SENT);

    await POST(jsonRequest({ replyContent: "답변" }), { params: { id: "inq-1" } });

    const sendInput = vi.mocked(gmailModule.sendReplyEmail).mock.calls[0][0];
    expect(sendInput.html).toContain("여신키우기 고객센터");
    expect(sendInput.html).toContain("게임 이용 문의 · 결제/환불");
    expect(sendInput.html).toContain("mahamaster");
    expect(sendInput.body).toContain("게임 계정: mahamaster");
  });

  it("still sends when the game and label lookups fail", async () => {
    const { from } = mockFetchInquiry({
      id: "inq-1",
      reply_email: "user@example.com",
      title: "제목",
      game_id: "game-1",
      inquiry_no: "R-1",
    });
    const original = from.getMockImplementation()!;
    from.mockImplementation((table: string) => {
      if (table === "games" || table === "inquiry_groups" || table === "inquiry_types") {
        throw new Error("db down");
      }
      return original(table);
    });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(SENT);

    const response = await POST(jsonRequest({ replyContent: "답변" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    const sendInput = vi.mocked(gmailModule.sendReplyEmail).mock.calls[0][0];
    expect(sendInput.html).toContain("THE PLAY+ 고객센터");
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
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(SENT);

    await POST(jsonRequest({ replyContent: "답변" }), { params: { id: "inq-1" } });

    expect(gmailModule.sendReplyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Re: 제목" })
    );
  });

  it("threads a follow-up reply onto the existing Gmail conversation", async () => {
    mockFetchInquiry({
      id: "inq-1",
      reply_email: "user@example.com",
      title: "제목",
      inquiry_no: "R-1",
      gmail_thread_id: "thread-1",
    });
    vi.mocked(messagesModule.listRfcMessageIds).mockResolvedValue(["<first@theplayplus.com>", "<reply@mail.example>"]);
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(SENT);

    await POST(jsonRequest({ replyContent: "두 번째 답변" }), { params: { id: "inq-1" } });

    expect(gmailModule.sendReplyEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        references: ["<first@theplayplus.com>", "<reply@mail.example>"],
      })
    );
  });

  it("warns instead of failing when the message record cannot be saved", async () => {
    mockFetchInquiry({ id: "inq-1", reply_email: "user@example.com", title: "제목", inquiry_no: "R-1" });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(SENT);
    vi.mocked(messagesModule.createOutboundMessage).mockResolvedValue(false);

    const response = await POST(jsonRequest({ replyContent: "답변" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, warning: "message_save_failed" });
  });

  it("still returns success when recording the event fails", async () => {
    mockFetchInquiry({ id: "inq-1", reply_email: "user@example.com", title: "제목", inquiry_no: "R-1" });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(SENT);
    vi.mocked(eventsModule.recordEvent).mockRejectedValue(new Error("boom"));

    const response = await POST(jsonRequest({ replyContent: "답변" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });
});
