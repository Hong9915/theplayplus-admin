import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/sync-replies/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as gmailModule from "@/lib/gmail";
import * as messagesModule from "@/lib/messages";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/gmail", () => ({ fetchInboundReplies: vi.fn(), fetchUnthreadedReplies: vi.fn() }));
vi.mock("@/lib/messages", () => ({ createInboundMessage: vi.fn(), listMessages: vi.fn() }));

type StoredMessage = Awaited<ReturnType<typeof messagesModule.listMessages>>[number];

function stored(partial: Partial<StoredMessage> & { direction: StoredMessage["direction"] }): StoredMessage {
  return {
    id: "msg",
    authorEmail: null,
    body: "본문",
    gmailMessageId: null,
    rfcMessageId: null,
    sentAt: "2026-09-01T00:00:00.000Z",
    autoSent: false,
    translations: {},
    ...partial,
  };
}

function mockInquiry(
  row: { id: string; game_id?: string | null; gmail_thread_id: string | null; reply_email?: string } | null
) {
  const single = vi.fn().mockResolvedValue({ data: row, error: row ? null : { message: "not found" } });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
}

const request = () => new Request("http://localhost/api/inquiries/inq-1/sync-replies", { method: "POST" });

describe("POST /api/inquiries/[id]/sync-replies", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(gmailModule.fetchInboundReplies).mockReset();
    vi.mocked(gmailModule.fetchUnthreadedReplies).mockReset().mockResolvedValue([]);
    vi.mocked(messagesModule.createInboundMessage).mockReset().mockResolvedValue(true);
    vi.mocked(messagesModule.listMessages).mockReset().mockResolvedValue([]);
    mockInquiry({ id: "inq-1", game_id: "game-1", gmail_thread_id: "thread-1", reply_email: "u@x.com" });
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    const response = await POST(request(), { params: { id: "inq-1" } });
    expect(response.status).toBe(401);
  });

  it("returns 404 for a missing inquiry", async () => {
    mockInquiry(null);
    const response = await POST(request(), { params: { id: "inq-1" } });
    expect(response.status).toBe(404);
  });

  it("rejects an inquiry that has no Gmail thread yet", async () => {
    mockInquiry({ id: "inq-1", gmail_thread_id: null });
    const response = await POST(request(), { params: { id: "inq-1" } });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, error: "no_thread" });
    expect(gmailModule.fetchInboundReplies).not.toHaveBeenCalled();
  });

  it("stores new inbound replies and skips ones already saved or empty", async () => {
    vi.mocked(messagesModule.listMessages).mockResolvedValue([stored({ direction: "inbound", gmailMessageId: "gm-old" })]);
    vi.mocked(gmailModule.fetchInboundReplies).mockResolvedValue([
      { gmailMessageId: "gm-old", rfcMessageId: null, fromEmail: "u@x.com", body: "이미 있음", sentAt: "2026-09-01T00:00:00.000Z" },
      { gmailMessageId: "gm-new", rfcMessageId: "<n@x.com>", fromEmail: "u@x.com", body: "새 회신", sentAt: "2026-09-01T01:00:00.000Z" },
      { gmailMessageId: "gm-empty", rfcMessageId: null, fromEmail: "u@x.com", body: "   ", sentAt: "2026-09-01T02:00:00.000Z" },
    ]);

    const response = await POST(request(), { params: { id: "inq-1" } });

    expect(gmailModule.fetchInboundReplies).toHaveBeenCalledWith("thread-1", "game");
    expect(messagesModule.createInboundMessage).toHaveBeenCalledTimes(1);
    expect(messagesModule.createInboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inquiryId: "inq-1", gmailMessageId: "gm-new", body: "새 회신" })
    );
    await expect(response.json()).resolves.toEqual({ success: true, added: 1 });
  });

  it("also picks up replies Gmail failed to thread, matched by our Message-IDs", async () => {
    vi.mocked(messagesModule.listMessages).mockResolvedValue([
      stored({ direction: "outbound", gmailMessageId: "gm-sent", rfcMessageId: "<ours@mail.gmail.com>", sentAt: "2026-09-16T06:02:03.000Z" }),
    ]);
    vi.mocked(gmailModule.fetchInboundReplies).mockResolvedValue([]);
    vi.mocked(gmailModule.fetchUnthreadedReplies).mockResolvedValue([
      { gmailMessageId: "gm-stray", rfcMessageId: "<s@x.com>", fromEmail: "u@x.com", body: "제목 바꾼 회신", sentAt: "2026-09-16T06:06:18.000Z" },
    ]);

    const response = await POST(request(), { params: { id: "inq-1" } });

    expect(gmailModule.fetchUnthreadedReplies).toHaveBeenCalledWith("game", {
      fromEmail: "u@x.com",
      since: new Date("2026-09-16T06:02:03.000Z"),
      rfcMessageIds: ["<ours@mail.gmail.com>"],
    });
    expect(messagesModule.createInboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inquiryId: "inq-1", gmailMessageId: "gm-stray", body: "제목 바꾼 회신" })
    );
    await expect(response.json()).resolves.toEqual({ success: true, added: 1 });
  });

  it("does not store the same reply twice when both lookups return it", async () => {
    const reply = { gmailMessageId: "gm-dup", rfcMessageId: null, fromEmail: "u@x.com", body: "회신", sentAt: "2026-09-16T06:06:18.000Z" };
    vi.mocked(messagesModule.listMessages).mockResolvedValue([
      stored({ direction: "outbound", rfcMessageId: "<ours@mail.gmail.com>", sentAt: "2026-09-16T06:02:03.000Z" }),
    ]);
    vi.mocked(gmailModule.fetchInboundReplies).mockResolvedValue([reply]);
    vi.mocked(gmailModule.fetchUnthreadedReplies).mockResolvedValue([reply]);

    const response = await POST(request(), { params: { id: "inq-1" } });

    expect(messagesModule.createInboundMessage).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({ success: true, added: 1 });
  });

  it("reads a service inquiry's thread from the service mailbox", async () => {
    mockInquiry({ id: "inq-1", game_id: null, gmail_thread_id: "thread-9", reply_email: "u@x.com" });
    vi.mocked(gmailModule.fetchInboundReplies).mockResolvedValue([]);

    await POST(request(), { params: { id: "inq-1" } });

    expect(gmailModule.fetchInboundReplies).toHaveBeenCalledWith("thread-9", "service");
  });

  it("reports a Gmail failure distinctly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(gmailModule.fetchInboundReplies).mockRejectedValue(new Error("scope"));

    const response = await POST(request(), { params: { id: "inq-1" } });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ success: false, error: "fetch_failed" });
    warn.mockRestore();
  });
});
