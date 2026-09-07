import { describe, it, expect, vi, beforeEach } from "vitest";

const { listInboundSince, mailboxSender } = vi.hoisted(() => ({
  listInboundSince: vi.fn(),
  mailboxSender: vi.fn(),
}));
vi.mock("@/lib/gmail", () => ({ listInboundSince, mailboxSender }));

import { syncMailbox, syncAllMailboxes } from "@/lib/reply-sync";

const NOW = new Date("2026-09-07T10:00:00.000Z");

interface FakeOptions {
  syncedThrough?: string | null;
  inquiries?: Array<{ id: string; gmail_thread_id: string; unread_reply_at: string | null }>;
  /** 이 gmail_message_id는 이미 저장돼 있어 insert가 실패한다. */
  knownMessageIds?: string[];
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
            in: async (_column: string, threadIds: string[]) => ({
              data: (options.inquiries ?? []).filter((row) => threadIds.includes(row.gmail_thread_id)),
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
          insert: async (row: Record<string, unknown>) => {
            inserts.push(row);
            return { error: known.has(row.gmail_message_id as string) ? { message: "duplicate" } : null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as never, inserts, updates, upserts };
}

function email(id: string, threadId: string, body = "회신 본문", sentAt = "2026-09-07T09:50:00.000Z") {
  return {
    gmailMessageId: id,
    threadId,
    rfcMessageId: `<${id}@example.com>`,
    fromEmail: "user@example.com",
    body,
    sentAt,
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  listInboundSince.mockReset();
  mailboxSender.mockReset();
  mailboxSender.mockImplementation((mailbox: string) =>
    mailbox === "game" ? "help@theplayplus.com" : "info@theplayplus.com"
  );
});

describe("syncMailbox", () => {
  it("stores replies whose thread belongs to an inquiry and marks it unread", async () => {
    listInboundSince.mockResolvedValue([email("m1", "t1")]);
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
    listInboundSince.mockResolvedValue([]);
    const db = fakeSupabase({ syncedThrough: "2026-09-07T09:55:00.000Z" });

    await syncMailbox(db.client, "game", { now: NOW });

    expect(listInboundSince).toHaveBeenCalledWith("game", new Date("2026-09-07T09:45:00.000Z"));
  });

  it("starts 24 hours back on the first run", async () => {
    listInboundSince.mockResolvedValue([]);
    const db = fakeSupabase({ syncedThrough: null });

    await syncMailbox(db.client, "service", { now: NOW });

    expect(listInboundSince).toHaveBeenCalledWith("service", new Date("2026-09-06T10:00:00.000Z"));
  });

  it("ignores mail whose thread matches no inquiry", async () => {
    listInboundSince.mockResolvedValue([email("m1", "unknown")]);
    const db = fakeSupabase({ syncedThrough: "2026-09-07T09:55:00.000Z", inquiries: [] });

    const result = await syncMailbox(db.client, "game", { now: NOW });

    expect(db.inserts).toEqual([]);
    expect(db.updates).toEqual([]);
    expect(db.upserts).toHaveLength(1);
    expect(result).toEqual({ mailbox: "game", fetched: 1, matched: 0, added: 0 });
  });

  it("does not mark unread when the message was already stored", async () => {
    listInboundSince.mockResolvedValue([email("m1", "t1")]);
    const db = fakeSupabase({
      syncedThrough: "2026-09-07T09:55:00.000Z",
      inquiries: [{ id: "inq-1", gmail_thread_id: "t1", unread_reply_at: null }],
      knownMessageIds: ["m1"],
    });

    const result = await syncMailbox(db.client, "game", { now: NOW });

    expect(db.updates).toEqual([]);
    expect(result.added).toBe(0);
  });

  it("skips replies with an empty body", async () => {
    listInboundSince.mockResolvedValue([email("m1", "t1", "   ")]);
    const db = fakeSupabase({
      syncedThrough: "2026-09-07T09:55:00.000Z",
      inquiries: [{ id: "inq-1", gmail_thread_id: "t1", unread_reply_at: null }],
    });

    const result = await syncMailbox(db.client, "game", { now: NOW });

    expect(db.inserts).toEqual([]);
    expect(result.added).toBe(0);
  });

  it("keeps an earlier unread mark instead of overwriting it", async () => {
    listInboundSince.mockResolvedValue([email("m1", "t1", "본문", "2026-09-07T09:50:00.000Z")]);
    const db = fakeSupabase({
      syncedThrough: "2026-09-07T09:55:00.000Z",
      inquiries: [{ id: "inq-1", gmail_thread_id: "t1", unread_reply_at: "2026-09-07T09:00:00.000Z" }],
    });

    await syncMailbox(db.client, "game", { now: NOW });

    expect(db.updates).toEqual([]);
  });

  it("leaves the synced time alone when Gmail fails", async () => {
    listInboundSince.mockRejectedValue(new Error("insufficient scope"));
    const db = fakeSupabase({ syncedThrough: "2026-09-07T09:55:00.000Z" });

    const result = await syncMailbox(db.client, "game", { now: NOW });

    expect(db.upserts).toEqual([]);
    expect(result).toEqual({ mailbox: "game", fetched: 0, matched: 0, added: 0, error: "fetch_failed" });
  });
});

describe("syncAllMailboxes", () => {
  it("syncs game and service mailboxes when they are different accounts", async () => {
    listInboundSince.mockResolvedValue([]);
    const db = fakeSupabase({ syncedThrough: "2026-09-07T09:55:00.000Z" });

    const results = await syncAllMailboxes(db.client, { now: NOW });

    expect(results.map((result) => result.mailbox)).toEqual(["game", "service"]);
  });

  it("syncs once when the service mailbox falls back to the game account", async () => {
    mailboxSender.mockReturnValue("help@theplayplus.com");
    listInboundSince.mockResolvedValue([]);
    const db = fakeSupabase({ syncedThrough: "2026-09-07T09:55:00.000Z" });

    const results = await syncAllMailboxes(db.client, { now: NOW });

    expect(results.map((result) => result.mailbox)).toEqual(["game"]);
    expect(listInboundSince).toHaveBeenCalledTimes(1);
  });

  it("still syncs the service mailbox when the game mailbox fails", async () => {
    listInboundSince.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([]);
    const db = fakeSupabase({ syncedThrough: "2026-09-07T09:55:00.000Z" });

    const results = await syncAllMailboxes(db.client, { now: NOW });

    expect(results[0].error).toBe("fetch_failed");
    expect(results[1]).toEqual({ mailbox: "service", fetched: 0, matched: 0, added: 0 });
  });
});
