import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/auto-reply/inquiry/route";
import * as supabaseModule from "@/lib/supabase";
import * as templatesModule from "@/lib/templates";
import * as messagesModule from "@/lib/messages";
import * as sendReplyModule from "@/lib/send-reply";
import type { ReplyableInquiry } from "@/lib/send-reply";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/templates", () => ({ findAutoReplyTemplate: vi.fn() }));
vi.mock("@/lib/messages", () => ({ listMessages: vi.fn() }));
vi.mock("@/lib/send-reply", async () => {
  const actual = await vi.importActual<typeof import("@/lib/send-reply")>("@/lib/send-reply");
  return { ...actual, sendInquiryReply: vi.fn() };
});

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

const template = { id: "tpl-1", typeKey: "refund", title: "환불 접수 안내", content: "환불 요청이 접수되었습니다.", autoSend: true };

function mockSupabase(row: ReplyableInquiry | null) {
  const single = vi.fn().mockResolvedValue({ data: row, error: row ? null : { message: "not found" } });
  const from = vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) }));
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
}

function makeRequest(body: unknown, secret: string | null = "s3cret") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["x-webhook-secret"] = secret;
  return new Request("https://admin.theplayplus.com/api/auto-reply/inquiry", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const insertPayload = { type: "INSERT", table: "inquiries", record: { id: "inq-1" } };

describe("POST /api/auto-reply/inquiry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INQUIRY_WEBHOOK_SECRET", "s3cret");
    mockSupabase(inquiry);
    vi.mocked(messagesModule.listMessages).mockResolvedValue([]);
    vi.mocked(templatesModule.findAutoReplyTemplate).mockResolvedValue(template);
    vi.mocked(sendReplyModule.sendInquiryReply).mockResolvedValue({
      sent: { gmailMessageId: "gm-1", gmailThreadId: "t-1", rfcMessageId: "<a>" },
      recorded: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a missing or wrong secret, and everything when the secret is unset", async () => {
    expect((await POST(makeRequest(insertPayload, null))).status).toBe(401);
    expect((await POST(makeRequest(insertPayload, "wrong"))).status).toBe(401);
    vi.stubEnv("INQUIRY_WEBHOOK_SECRET", "");
    expect((await POST(makeRequest(insertPayload))).status).toBe(401);
    expect(sendReplyModule.sendInquiryReply).not.toHaveBeenCalled();
  });

  it("rejects payloads that are not an inquiries INSERT", async () => {
    expect((await POST(makeRequest({ type: "UPDATE", table: "inquiries", record: { id: "x" } }))).status).toBe(400);
    expect((await POST(makeRequest({ type: "INSERT", table: "games", record: { id: "x" } }))).status).toBe(400);
    expect(sendReplyModule.sendInquiryReply).not.toHaveBeenCalled();
  });

  it("returns 404 when the inquiry cannot be read back", async () => {
    mockSupabase(null);
    expect((await POST(makeRequest(insertPayload))).status).toBe(404);
  });

  it("sends the type's auto template as an automatic reply", async () => {
    const response = await POST(makeRequest(insertPayload));

    expect(templatesModule.findAutoReplyTemplate).toHaveBeenCalledWith(expect.anything(), "game-1", "refund");
    expect(sendReplyModule.sendInquiryReply).toHaveBeenCalledWith(expect.anything(), {
      inquiry,
      body: "환불 요청이 접수되었습니다.",
      mode: "auto",
    });
    await expect(response.json()).resolves.toEqual({ success: true, sent: true });
  });

  it("skips inquiries without a game", async () => {
    mockSupabase({ ...inquiry, game_id: null });
    const response = await POST(makeRequest(insertPayload));
    await expect(response.json()).resolves.toEqual({ success: true, sent: false, reason: "no_game" });
    expect(sendReplyModule.sendInquiryReply).not.toHaveBeenCalled();
  });

  it("does not send twice when the webhook is retried after a reply went out", async () => {
    vi.mocked(messagesModule.listMessages).mockResolvedValue([
      { id: "m1", direction: "outbound", authorEmail: null, body: "x", gmailMessageId: "g", rfcMessageId: null, sentAt: "2026-09-03T00:00:00.000Z", autoSent: true },
    ]);
    const response = await POST(makeRequest(insertPayload));
    await expect(response.json()).resolves.toEqual({ success: true, sent: false, reason: "already_replied" });
    expect(sendReplyModule.sendInquiryReply).not.toHaveBeenCalled();
  });

  it("skips quietly when the type has no auto template", async () => {
    vi.mocked(templatesModule.findAutoReplyTemplate).mockResolvedValue(null);
    const response = await POST(makeRequest(insertPayload));
    await expect(response.json()).resolves.toEqual({ success: true, sent: false, reason: "no_template" });
    expect(sendReplyModule.sendInquiryReply).not.toHaveBeenCalled();
  });

  it("returns 502 so Supabase can retry when sending fails", async () => {
    vi.mocked(sendReplyModule.sendInquiryReply).mockRejectedValue(new Error("gmail down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(makeRequest(insertPayload));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ success: false, error: "send_failed" });
  });
});
