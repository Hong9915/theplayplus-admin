import { describe, it, expect, vi, beforeEach } from "vitest";

const { listInboundIdsSince, getInboundMessage, getReplyHeaders, getAttachment, openMailbox, saveInboundAttachments } = vi.hoisted(() => ({
  listInboundIdsSince: vi.fn(),
  getInboundMessage: vi.fn(),
  getReplyHeaders: vi.fn(),
  getAttachment: vi.fn(),
  openMailbox: vi.fn(),
  saveInboundAttachments: vi.fn(),
}));
vi.mock("@/lib/gmail", () => ({ openMailbox }));
vi.mock("@/lib/message-attachments", () => ({ saveInboundAttachments }));

/** 메일함에 있는 메일. list는 id/threadId만, get은 본문까지 준다. */
function mailboxHas(emails: ReturnType<typeof email>[]) {
  listInboundIdsSince.mockResolvedValue(emails.map((entry) => ({ id: entry.gmailMessageId, threadId: entry.threadId })));
  getInboundMessage.mockImplementation(async (id: string) => emails.find((entry) => entry.gmailMessageId === id) ?? null);
}

import { syncMailbox, syncAllMailboxes } from "@/lib/reply-sync";

const NOW = new Date("2026-09-07T10:00:00.000Z");

interface FakeOptions {
  syncedThrough?: string | null;
  inquiries?: Array<{ id: string; gmail_thread_id: string; unread_reply_at: string | null }>;
  /** 이 gmail_message_id는 이미 저장돼 있어 insert가 실패한다. */
  knownMessageIds?: string[];
  /** 우리가 보낸 메일의 Message-ID. 스레드가 어긋난 회신을 이걸로 맞춘다. */
  outbound?: Array<{ inquiry_id: string; rfc_message_id: string }>;
}

function fakeSupabase(options: FakeOptions = {}) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<{ patch: Record<string, unknown>; id: string }> = [];
  const upserts: Array<Record<string, unknown>> = [];
  const known = new Set(options.knownMessageIds ?? []);

  const client = {
    from(table: string) {
      if (table === "gmail_sync_state") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.syncedThrough === undefined || options.syncedThrough === null
                  ? null
                  : { synced_through: options.syncedThrough },
                error: null,
              }),
            }),
          }),
          upsert: async (row: Record<string, unknown>) => {
            upserts.push(row);
            return { error: null };
          },
        };
      }
      if (table === "inquiries") {
        return {
          select: () => ({
            in: async (column: string, values: string[]) => ({
              data: (options.inquiries ?? []).filter((row) =>
                column === "id" ? values.includes(row.id) : values.includes(row.gmail_thread_id)
              ),
              error: null,
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_column: string, id: string) => {
              updates.push({ patch, id });
              return { error: null };
            },
          }),
        };
      }
      if (table === "inquiry_messages") {
        return {
          select: () => ({
            in: async (column: string, ids: string[]) => ({
              data:
                column === "rfc_message_id"
                  ? (options.outbound ?? []).filter((row) => ids.includes(row.rfc_message_id))
                  : ids.filter((id) => known.has(id)).map((id) => ({ gmail_message_id: id })),
              error: null,
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            inserts.push(row);
            const duplicate = known.has(row.gmail_message_id as string);
            return {
              select: () => ({
                single: async () =>
                  duplicate ? { data: null, error: { message: "duplicate" } } : { data: { id: `row-${row.gmail_message_id}` }, error: null },
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as never, inserts, updates, upserts };
}

function email(
  id: string,
  threadId: string,
  body = "회신 본문",
  sentAt = "2026-09-07T09:50:00.000Z",
  attachments: Array<{ attachmentId: string; filename: string; mimeType: "image/png"; size: number }> = []
) {
  return {
    gmailMessageId: id,
    threadId,
    rfcMessageId: `<${id}@example.com>`,
    fromEmail: "user@example.com",
    body,
    sentAt,
    attachments,
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  listInboundIdsSince.mockReset();
  getInboundMessage.mockReset();
  getReplyHeaders.mockReset().mockResolvedValue([]);
  getAttachment.mockReset();
  saveInboundAttachments.mockReset().mockResolvedValue(0);
  openMailbox.mockReset();
  openMailbox.mockImplementation((mailbox: string) => ({
    sender: mailbox === "game" ? "help@theplayplus.com" : "info@theplayplus.com",
    listInboundIdsSince,
    getInboundMessage,
    getReplyHeaders,
    getAttachment,
  }));
});

describe("syncMailbox", () => {
  it("keeps a photo-only reply and saves its photos onto the stored message", async () => {
    const photo = { attachmentId: "att-1", filename: "화면.png", mimeType: "image/png" as const, size: 10 };
    mailboxHas([email("m1", "t1", "", "2026-09-07T09:50:00.000Z", [photo])]);
    const db = fakeSupabase({
      syncedThrough: "2026-09-07T09:55:00.000Z",
      inquiries: [{ id: "inq-1", gmail_thread_id: "t1", unread_reply_at: null }],
    });
    getAttachment.mockResolvedValue(Buffer.from([1]));

    const result = await syncMailbox(db.client, "game", { now: NOW });

    expect(result.added).toBe(1);
    const call = saveInboundAttachments.mock.calls[0][1];
    expect(call).toEqual(expect.objectContaining({ inquiryId: "inq-1", messageId: "row-m1", attachments: [photo] }));
    await call.download("att-1");
    expect(getAttachment).toHaveBeenCalledWith("m1", "att-1");
  });

  it("stores replies whose thread belongs to an inquiry and marks it unread", async () => {
    mailboxHas([email("m1", "t1")]);
    const db = fakeSupabase({
      syncedThrough: "2026-09-07T09:55:00.000Z",
      inquiries: [{ id: "inq-1", gmail_thread_id: "t1", unread_reply_at: null }],
    });

    const result = await syncMailbox(db.client, "game", { now: NOW });

    expect(db.inserts).toEqual([
      expect.objectContaining({
        inquiry_id: "inq-1",
        direction: "inbound",
        gmail_message_id: "m1",
        body: "회신 본문",
        sent_at: "2026-09-07T09:50:00.000Z",
      }),
    ]);
    expect(db.updates).toEqual([{ id: "inq-1", patch: { unread_reply_at: "2026-09-07T09:50:00.000Z" } }]);
    expect(db.upserts).toEqual([
      expect.objectContaining({ mailbox: "game", synced_through: NOW.toISOString() }),
    ]);
    expect(result).toEqual({ mailbox: "game", fetched: 1, matched: 1, added: 1 });
  });

  it("looks back 10 minutes before the last synced time", async () => {
    mailboxHas([]);
    const db = fakeSupabase({ syncedThrough: "2026-09-07T09:55:00.000Z" });

    await syncMailbox(db.client, "game", { now: NOW });

    expect(openMailbox).toHaveBeenCalledWith("game");
    expect(listInboundIdsSince).toHaveBeenCalledWith(new Date("2026-09-07T09:45:00.000Z"));
  });

  it("starts 24 hours back on the first run", async () => {
    mailboxHas([]);
    const db = fakeSupabase({ syncedThrough: null });

    await syncMailbox(db.client, "service", { now: NOW });

    expect(openMailbox).toHaveBeenCalledWith("service");
    expect(listInboundIdsSince).toHaveBeenCalledWith(new Date("2026-09-06T10:00:00.000Z"));
  });

  it("ignores mail whose thread matches no inquiry", async () => {
    mailboxHas([email("m1", "unknown")]);
    const db = fakeSupabase({ syncedThrough: "2026-09-07T09:55:00.000Z", inquiries: [] });

    const result = await syncMailbox(db.client, "game", { now: NOW });

    expect(getInboundMessage).not.toHaveBeenCalled();
    expect(db.inserts).toEqual([]);
    expect(db.updates).toEqual([]);
    expect(db.upserts).toHaveLength(1);
    expect(result).toEqual({ mailbox: "game", fetched: 1, matched: 0, added: 0 });
  });

  it("matches a reply Gmail put in its own thread by its In-Reply-To header", async () => {
    // 사용자가 제목을 바꿔 답장하면 Gmail이 새 스레드로 만든다(2026-09-16 실측).
    mailboxHas([email("m1", "m1")]);
    getReplyHeaders.mockResolvedValue(["<sent@mail.gmail.com>"]);
    const db = fakeSupabase({
      syncedThrough: "2026-09-07T09:55:00.000Z",
      inquiries: [{ id: "inq-1", gmail_thread_id: "t1", unread_reply_at: null }],
      outbound: [{ inquiry_id: "inq-1", rfc_message_id: "<sent@mail.gmail.com>" }],
    });

    const result = await syncMailbox(db.client, "game", { now: NOW });

    expect(getReplyHeaders).toHaveBeenCalledWith("m1");
    expect(db.inserts).toEqual([expect.objectContaining({ inquiry_id: "inq-1", gmail_message_id: "m1" })]);
    expect(db.updates).toEqual([{ id: "inq-1", patch: { unread_reply_at: "2026-09-07T09:50:00.000Z" } }]);
    expect(result).toEqual({ mailbox: "game", fetched: 1, matched: 1, added: 1 });
  });

  it("does not read headers of mail whose thread already matched", async () => {
    mailboxHas([email("m1", "t1")]);
    const db = fakeSupabase({
      syncedThrough: "2026-09-07T09:55:00.000Z",
      inquiries: [{ id: "inq-1", gmail_thread_id: "t1", unread_reply_at: null }],
    });

    await syncMailbox(db.client, "game", { now: NOW });

    expect(getReplyHeaders).not.toHaveBeenCalled();
  });

  it("keeps going when reading a stray mail's headers fails", async () => {
    mailboxHas([email("m1", "m1"), email("m2", "m2")]);
    getReplyHeaders.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(["<sent@mail.gmail.com>"]);
    const db = fakeSupabase({
      syncedThrough: "2026-09-07T09:55:00.000Z",
      inquiries: [{ id: "inq-1", gmail_thread_id: "t1", unread_reply_at: null }],
      outbound: [{ inquiry_id: "inq-1", rfc_message_id: "<sent@mail.gmail.com>" }],
    });

    const result = await syncMailbox(db.client, "game", { now: NOW });

    expect(db.inserts).toEqual([expect.objectContaining({ inquiry_id: "inq-1", gmail_message_id: "m2" })]);
    expect(result).toEqual({ mailbox: "game", fetched: 2, matched: 1, added: 1 });
  });

  it("does not fetch or mark messages that are already stored", async () => {
    mailboxHas([email("m1", "t1")]);
    const db = fakeSupabase({
      syncedThrough: "2026-09-07T09:55:00.000Z",
      inquiries: [{ id: "inq-1", gmail_thread_id: "t1", unread_reply_at: null }],
      knownMessageIds: ["m1"],
    });

    const result = await syncMailbox(db.client, "game", { now: NOW });

    expect(getInboundMessage).not.toHaveBeenCalled();
    expect(db.inserts).toEqual([]);
    expect(db.updates).toEqual([]);
    expect(result.added).toBe(0);
  });

  it("skips replies with an empty body", async () => {
    mailboxHas([email("m1", "t1", "   ")]);
    const db = fakeSupabase({
      syncedThrough: "2026-09-07T09:55:00.000Z",
      inquiries: [{ id: "inq-1", gmail_thread_id: "t1", unread_reply_at: null }],
    });

    const result = await syncMailbox(db.client, "game", { now: NOW });

    expect(db.inserts).toEqual([]);
    expect(result.added).toBe(0);
  });

  it("keeps an earlier unread mark instead of overwriting it", async () => {
    mailboxHas([email("m1", "t1", "본문", "2026-09-07T09:50:00.000Z")]);
    const db = fakeSupabase({
      syncedThrough: "2026-09-07T09:55:00.000Z",
      inquiries: [{ id: "inq-1", gmail_thread_id: "t1", unread_reply_at: "2026-09-07T09:00:00.000Z" }],
    });

    await syncMailbox(db.client, "game", { now: NOW });

    expect(db.updates).toEqual([]);
  });

  it("leaves the synced time alone when Gmail fails", async () => {
    listInboundIdsSince.mockRejectedValue(new Error("insufficient scope"));
    const db = fakeSupabase({ syncedThrough: "2026-09-07T09:55:00.000Z" });

    const result = await syncMailbox(db.client, "game", { now: NOW });

    expect(db.upserts).toEqual([]);
    expect(result).toEqual({ mailbox: "game", fetched: 0, matched: 0, added: 0, error: "fetch_failed" });
  });
});

describe("syncAllMailboxes", () => {
  it("syncs game and service mailboxes when they are different accounts", async () => {
    mailboxHas([]);
    const db = fakeSupabase({ syncedThrough: "2026-09-07T09:55:00.000Z" });

    const results = await syncAllMailboxes(db.client, { now: NOW });

    expect(results.map((result) => result.mailbox)).toEqual(["game", "service"]);
  });

  it("syncs once when the service mailbox falls back to the game account", async () => {
    openMailbox.mockImplementation(() => ({ sender: "help@theplayplus.com", listInboundIdsSince, getInboundMessage }));
    mailboxHas([]);
    const db = fakeSupabase({ syncedThrough: "2026-09-07T09:55:00.000Z" });

    const results = await syncAllMailboxes(db.client, { now: NOW });

    expect(results.map((result) => result.mailbox)).toEqual(["game"]);
    expect(listInboundIdsSince).toHaveBeenCalledTimes(1);
  });

  it("still syncs the service mailbox when the game mailbox fails", async () => {
    listInboundIdsSince.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([]);
    const db = fakeSupabase({ syncedThrough: "2026-09-07T09:55:00.000Z" });

    const results = await syncAllMailboxes(db.client, { now: NOW });

    expect(results[0].error).toBe("fetch_failed");
    expect(results[1]).toEqual({ mailbox: "service", fetched: 0, matched: 0, added: 0 });
  });
});
