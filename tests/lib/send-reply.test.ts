import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReplySaveError, sendInquiryReply, type ReplyableInquiry } from "@/lib/send-reply";
import * as gmailModule from "@/lib/gmail";
import * as eventsModule from "@/lib/events";
import * as messagesModule from "@/lib/messages";
import * as embeddingsModule from "@/lib/embeddings";

vi.mock("@/lib/gmail", () => ({
  sendReplyEmail: vi.fn(),
  mailboxSender: vi.fn((mailbox: string) => (mailbox === "service" ? "info@theplayplus.com" : "help@theplayplus.com")),
}));
vi.mock("@/lib/events", async () => {
  const actual = await vi.importActual<typeof import("@/lib/events")>("@/lib/events");
  return { ...actual, recordEvent: vi.fn() };
});
vi.mock("@/lib/messages", () => ({ createOutboundMessage: vi.fn(), listRfcMessageIds: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ ensureInquiryEmbedding: vi.fn() }));

const SENT = { gmailMessageId: "gm-1", gmailThreadId: "thread-1", rfcMessageId: "<abc@theplayplus.com>" };
const ADMIN = { id: "user-1", email: "hong@theplayplus.com" };

const inquiry: ReplyableInquiry = {
  id: "inq-1",
  game_id: "game-1",
  group_key: "payment_refund",
  type_key: "refund",
  game_account: "luna_park",
  reply_email: "luna@example.com",
  title: "중복 결제",
  content: "두 번 결제됐어요",
  inquiry_no: "R-20260903-0001",
  gmail_thread_id: null,
};

function mockSupabase(updateError: { message: string } | null = null) {
  const eqUpdate = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn(() => ({ eq: eqUpdate }));
  const single = vi.fn().mockResolvedValue({ data: { name: "여신 키우기" }, error: null });
  const gameSelect = vi.fn(() => ({ eq: vi.fn(() => ({ single })) }));
  const groupsSelect = vi.fn(() => ({
    eq: vi.fn(() => ({
      order: vi.fn().mockResolvedValue({ data: [{ id: "grp-1", key: "payment_refund", label_ko: "결제/환불" }], error: null }),
    })),
  }));
  const typesSelect = vi.fn(() => ({
    in: vi.fn(() => ({
      order: vi.fn().mockResolvedValue({ data: [{ key: "refund", label_ko: "환불", group_id: "grp-1" }], error: null }),
    })),
  }));
  const from = vi.fn((table: string) => {
    if (table === "games") return { select: gameSelect };
    if (table === "inquiry_groups") return { select: groupsSelect };
    if (table === "inquiry_types") return { select: typesSelect };
    return { update };
  });
  return { supabase: { from } as never, update, eqUpdate };
}

describe("sendInquiryReply", () => {
  beforeEach(() => {
    vi.mocked(gmailModule.sendReplyEmail).mockReset().mockResolvedValue(SENT);
    vi.mocked(eventsModule.recordEvent).mockReset().mockResolvedValue(undefined);
    vi.mocked(messagesModule.createOutboundMessage).mockReset().mockResolvedValue(true);
    vi.mocked(messagesModule.listRfcMessageIds).mockReset().mockResolvedValue([]);
    vi.mocked(embeddingsModule.ensureInquiryEmbedding).mockReset().mockResolvedValue([0.1]);
  });

  it("manual: sends the branded email, marks in_progress, and records the admin", async () => {
    const { supabase, update, eqUpdate } = mockSupabase();

    const result = await sendInquiryReply(supabase, { inquiry, body: "환불 처리했습니다", mode: "manual", actor: ADMIN });

    expect(gmailModule.sendReplyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "luna@example.com", subject: "[R-20260903-0001] Re: 중복 결제", threadId: null })
    );
    const sendInput = vi.mocked(gmailModule.sendReplyEmail).mock.calls[0][0];
    expect(sendInput.mailbox).toBe("game");
    expect(sendInput.html).toContain("여신 키우기 고객센터");
    expect(sendInput.html).toContain("결제/환불 · 환불");
    expect(sendInput.html).toContain("help@theplayplus.com");
    expect(sendInput.body).toContain("help@theplayplus.com");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress", reply_content: "환불 처리했습니다", draft_reply: null, gmail_thread_id: "thread-1" })
    );
    expect(eqUpdate).toHaveBeenCalledWith("id", "inq-1");
    expect(messagesModule.createOutboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inquiryId: "inq-1", author: ADMIN, autoSent: false, gmailMessageId: "gm-1" })
    );
    expect(eventsModule.recordEvent).toHaveBeenCalledWith(expect.anything(), { inquiryId: "inq-1", actor: ADMIN, kind: "reply_sent" });
    expect(result).toEqual({ sent: SENT, recorded: true });
  });

  it("auto: leaves status and last reply alone, stores only the thread id, and marks the message auto", async () => {
    const { supabase, update } = mockSupabase();

    await sendInquiryReply(supabase, { inquiry, body: "접수되었습니다", mode: "auto" });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ gmail_thread_id: "thread-1" });
    expect(messagesModule.createOutboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ author: null, autoSent: true, body: "접수되었습니다" })
    );
    expect(eventsModule.recordEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actor: eventsModule.AUTO_REPLY_ACTOR, kind: "auto_reply_sent" })
    );
  });

  it("service inquiries go out from the service mailbox with its address in the footer", async () => {
    const { supabase } = mockSupabase();
    const serviceInquiry: ReplyableInquiry = { ...inquiry, game_id: null, group_key: "partnership", type_key: "partnership" };

    await sendInquiryReply(supabase, { inquiry: serviceInquiry, body: "검토하겠습니다", mode: "manual", actor: ADMIN });

    const sendInput = vi.mocked(gmailModule.sendReplyEmail).mock.calls[0][0];
    expect(sendInput.mailbox).toBe("service");
    expect(sendInput.html).toContain("info@theplayplus.com");
    expect(sendInput.html).not.toContain("help@theplayplus.com");
    expect(sendInput.body).toContain("info@theplayplus.com");
  });

  it("threads onto the existing conversation when there is one", async () => {
    const { supabase } = mockSupabase();
    vi.mocked(messagesModule.listRfcMessageIds).mockResolvedValue(["<first@theplayplus.com>"]);

    await sendInquiryReply(supabase, { inquiry: { ...inquiry, gmail_thread_id: "thread-0" }, body: "x", mode: "auto" });

    expect(gmailModule.sendReplyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-0", references: ["<first@theplayplus.com>"] })
    );
  });

  it("rethrows a send failure without touching the inquiry", async () => {
    const { supabase, update } = mockSupabase();
    vi.mocked(gmailModule.sendReplyEmail).mockRejectedValue(new Error("gmail down"));

    await expect(sendInquiryReply(supabase, { inquiry, body: "x", mode: "auto" })).rejects.toThrow("gmail down");
    expect(update).not.toHaveBeenCalled();
    expect(messagesModule.createOutboundMessage).not.toHaveBeenCalled();
  });

  it("throws ReplySaveError when the inquiry update fails after sending", async () => {
    const { supabase } = mockSupabase({ message: "db" });

    await expect(sendInquiryReply(supabase, { inquiry, body: "x", mode: "manual", actor: ADMIN })).rejects.toBeInstanceOf(ReplySaveError);
    expect(messagesModule.createOutboundMessage).not.toHaveBeenCalled();
  });

  it("reports recorded=false instead of failing when the message cannot be saved", async () => {
    const { supabase } = mockSupabase();
    vi.mocked(messagesModule.createOutboundMessage).mockResolvedValue(false);
    vi.mocked(eventsModule.recordEvent).mockRejectedValue(new Error("boom"));

    const result = await sendInquiryReply(supabase, { inquiry, body: "x", mode: "auto" });

    expect(result.recorded).toBe(false);
  });

  it("manual: makes sure the inquiry has an embedding after the reply is recorded", async () => {
    const { supabase } = mockSupabase();

    await sendInquiryReply(supabase, { inquiry, body: "환불 처리했습니다", mode: "manual", actor: ADMIN });

    expect(embeddingsModule.ensureInquiryEmbedding).toHaveBeenCalledWith(supabase, {
      id: "inq-1",
      title: "중복 결제",
      content: "두 번 결제됐어요",
    });
  });

  it("auto: does not touch the embedding", async () => {
    const { supabase } = mockSupabase();

    await sendInquiryReply(supabase, { inquiry, body: "접수됐습니다", mode: "auto" });

    expect(embeddingsModule.ensureInquiryEmbedding).not.toHaveBeenCalled();
  });

  it("manual: an embedding failure does not change the result", async () => {
    vi.mocked(embeddingsModule.ensureInquiryEmbedding).mockRejectedValue(new Error("boom"));
    const { supabase } = mockSupabase();

    const result = await sendInquiryReply(supabase, { inquiry, body: "환불 처리했습니다", mode: "manual", actor: ADMIN });

    expect(result.recorded).toBe(true);
  });
});
