import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/sync-replies/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as gmailModule from "@/lib/gmail";
import * as messagesModule from "@/lib/messages";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/gmail", () => ({ fetchInboundReplies: vi.fn() }));
vi.mock("@/lib/messages", () => ({ createInboundMessage: vi.fn(), listGmailMessageIds: vi.fn() }));

function mockInquiry(row: { id: string; gmail_thread_id: string | null } | null) {
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
    vi.mocked(messagesModule.createInboundMessage).mockReset().mockResolvedValue(true);
    vi.mocked(messagesModule.listGmailMessageIds).mockReset().mockResolvedValue(new Set());
    mockInquiry({ id: "inq-1", gmail_thread_id: "thread-1" });
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
    vi.mocked(messagesModule.listGmailMessageIds).mockResolvedValue(new Set(["gm-old"]));
    vi.mocked(gmailModule.fetchInboundReplies).mockResolvedValue([
      { gmailMessageId: "gm-old", rfcMessageId: null, fromEmail: "u@x.com", body: "이미 있음", sentAt: "2026-09-01T00:00:00.000Z" },
      { gmailMessageId: "gm-new", rfcMessageId: "<n@x.com>", fromEmail: "u@x.com", body: "새 회신", sentAt: "2026-09-01T01:00:00.000Z" },
      { gmailMessageId: "gm-empty", rfcMessageId: null, fromEmail: "u@x.com", body: "   ", sentAt: "2026-09-01T02:00:00.000Z" },
    ]);

    const response = await POST(request(), { params: { id: "inq-1" } });

    expect(gmailModule.fetchInboundReplies).toHaveBeenCalledWith("thread-1");
    expect(messagesModule.createInboundMessage).toHaveBeenCalledTimes(1);
    expect(messagesModule.createInboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inquiryId: "inq-1", gmailMessageId: "gm-new", body: "새 회신" })
    );
    await expect(response.json()).resolves.toEqual({ success: true, added: 1 });
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
