import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendReplyEmail } = vi.hoisted(() => ({ sendReplyEmail: vi.fn() }));
vi.mock("@/lib/gmail", () => ({
  sendReplyEmail,
  mailboxSender: () => "help@theplayplus.com",
}));
vi.mock("@/lib/email-logo", () => ({
  EMAIL_LOGO_CID: "logo",
  EMAIL_LOGO_CONTENT_TYPE: "image/png",
  EMAIL_LOGO_FILENAME: "logo.png",
  getEmailLogo: () => Buffer.from(""),
}));

import { sendInquiryReply, type ReplyableInquiry } from "@/lib/send-reply";

const inquiry: ReplyableInquiry = {
  id: "inq-1",
  game_id: "g1",
  group_key: "game_usage",
  type_key: "bug_report",
  game_account: "user#1",
  reply_email: "user@example.com",
  title: "제목",
  content: "본문",
  inquiry_no: "R-1",
  gmail_thread_id: "t1",
};

function fakeSupabase() {
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      if (table === "inquiries") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              updates.push(patch);
              return { error: null };
            },
          }),
        };
      }
      // inquiry_messages(select/insert), inquiry_events(insert), 카테고리 라벨 조회
      const chain: Record<string, unknown> = {};
      for (const name of ["select", "eq", "in", "order", "insert"]) {
        chain[name] = () => chain;
      }
      chain.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
      return chain;
    },
  };
  return { client: client as never, updates };
}

describe("sendInquiryReply", () => {
  beforeEach(() => {
    sendReplyEmail.mockReset();
    sendReplyEmail.mockResolvedValue({ gmailMessageId: "gm-1", gmailThreadId: "t1", rfcMessageId: "<x@y>" });
  });

  it("clears the unread reply mark when an admin sends a reply", async () => {
    const db = fakeSupabase();
    await sendInquiryReply(db.client, {
      inquiry,
      body: "답변",
      mode: "manual",
      actor: { id: "admin", email: "admin@theplayplus.com" },
    });
    expect(db.updates[0]).toEqual(expect.objectContaining({ status: "in_progress", unread_reply_at: null }));
  });

  it("leaves the unread mark alone for automatic replies", async () => {
    const db = fakeSupabase();
    await sendInquiryReply(db.client, { inquiry, body: "자동", mode: "auto" });
    expect(db.updates[0]).not.toHaveProperty("unread_reply_at");
  });
});
