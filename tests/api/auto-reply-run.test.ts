import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/auto-reply/run/route";
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

const rpc = vi.fn();
const update = vi.fn();

function mockSupabase(claimed: ReplyableInquiry[] | null) {
  rpc.mockResolvedValue({ data: claimed, error: claimed ? null : { message: "boom" } });
  const eq = vi.fn().mockResolvedValue({ error: null });
  update.mockReturnValue({ eq });
  const from = vi.fn(() => ({ update }));
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
}

function makeRequest(secret: string | null = "s3cret") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["x-webhook-secret"] = secret;
  return new Request("https://admin.theplayplus.com/api/auto-reply/run", { method: "POST", headers, body: "{}" });
}

describe("POST /api/auto-reply/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INQUIRY_WEBHOOK_SECRET", "s3cret");
    mockSupabase([inquiry]);
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
    expect((await POST(makeRequest(null))).status).toBe(401);
    expect((await POST(makeRequest("wrong"))).status).toBe(401);
    vi.stubEnv("INQUIRY_WEBHOOK_SECRET", "");
    expect((await POST(makeRequest())).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(sendReplyModule.sendInquiryReply).not.toHaveBeenCalled();
  });

  it("claims due inquiries through the RPC and sends each one's auto template", async () => {
    const response = await POST(makeRequest());

    expect(rpc).toHaveBeenCalledWith("claim_due_auto_replies", { p_limit: 10 });
    expect(templatesModule.findAutoReplyTemplate).toHaveBeenCalledWith(expect.anything(), "game-1", "refund");
    expect(sendReplyModule.sendInquiryReply).toHaveBeenCalledWith(expect.anything(), {
      inquiry,
      body: "환불 요청이 접수되었습니다.",
      mode: "auto",
    });
    await expect(response.json()).resolves.toEqual({ success: true, claimed: 1, sent: 1, skipped: 0, failed: 0 });
  });

  it("returns 502 when the claim itself fails", async () => {
    mockSupabase(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(makeRequest());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ success: false, error: "claim_failed" });
    expect(sendReplyModule.sendInquiryReply).not.toHaveBeenCalled();
  });

  it("does nothing when nothing is due", async () => {
    mockSupabase([]);
    const response = await POST(makeRequest());
    await expect(response.json()).resolves.toEqual({ success: true, claimed: 0, sent: 0, skipped: 0, failed: 0 });
    expect(sendReplyModule.sendInquiryReply).not.toHaveBeenCalled();
  });

  it("skips an inquiry that already got a reply while it was waiting", async () => {
    vi.mocked(messagesModule.listMessages).mockResolvedValue([
      { id: "m1", direction: "outbound", authorEmail: "admin@theplayplus.com", body: "x", gmailMessageId: "g", rfcMessageId: null, sentAt: "2026-09-04T00:00:00.000Z", autoSent: false },
    ]);
    const response = await POST(makeRequest());
    await expect(response.json()).resolves.toEqual({ success: true, claimed: 1, sent: 0, skipped: 1, failed: 0 });
    expect(sendReplyModule.sendInquiryReply).not.toHaveBeenCalled();
  });

  it("skips an inquiry whose type no longer has an auto template", async () => {
    vi.mocked(templatesModule.findAutoReplyTemplate).mockResolvedValue(null);
    const response = await POST(makeRequest());
    await expect(response.json()).resolves.toEqual({ success: true, claimed: 1, sent: 0, skipped: 1, failed: 0 });
    expect(sendReplyModule.sendInquiryReply).not.toHaveBeenCalled();
  });

  it("skips an inquiry without a game", async () => {
    mockSupabase([{ ...inquiry, game_id: null }]);
    const response = await POST(makeRequest());
    await expect(response.json()).resolves.toEqual({ success: true, claimed: 1, sent: 0, skipped: 1, failed: 0 });
    expect(sendReplyModule.sendInquiryReply).not.toHaveBeenCalled();
  });

  it("reschedules a failed send five minutes later and keeps going with the rest", async () => {
    const second = { ...inquiry, id: "inq-2" };
    mockSupabase([inquiry, second]);
    vi.mocked(sendReplyModule.sendInquiryReply).mockRejectedValueOnce(new Error("gmail down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ now: new Date("2026-09-04T12:00:00.000Z") });

    const response = await POST(makeRequest());

    expect(update).toHaveBeenCalledWith({ auto_reply_due_at: "2026-09-04T12:05:00.000Z" });
    expect(update.mock.results[0].value.eq).toHaveBeenCalledWith("id", "inq-1");
    expect(sendReplyModule.sendInquiryReply).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toEqual({ success: true, claimed: 2, sent: 1, skipped: 0, failed: 1 });
    vi.useRealTimers();
  });
});
