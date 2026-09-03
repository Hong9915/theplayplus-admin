import { describe, it, expect, vi } from "vitest";
import {
  createInboundMessage,
  createOutboundMessage,
  listGmailMessageIds,
  listMessages,
  listRfcMessageIds,
} from "@/lib/messages";

const rows = [
  {
    id: "m1",
    direction: "outbound",
    author_email: "info@theplayplus.com",
    body: "첫 답변",
    gmail_message_id: "gm-1",
    rfc_message_id: "<a@theplayplus.com>",
    sent_at: "2026-09-01T00:00:00.000Z",
    auto_sent: false,
  },
  {
    id: "m2",
    direction: "inbound",
    author_email: "user@example.com",
    body: "회신",
    gmail_message_id: "gm-2",
    rfc_message_id: null,
    sent_at: "2026-09-01T01:00:00.000Z",
    auto_sent: false,
  },
];

function mockSelect(data: unknown, error: { message: string } | null = null) {
  const order = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ select, insert }));
  return { from, select, eq, order, insert };
}

describe("listMessages", () => {
  it("returns the thread oldest first with camelCase fields", async () => {
    const { from, eq, order } = mockSelect(rows);
    const result = await listMessages({ from } as never, "inq-1");

    expect(from).toHaveBeenCalledWith("inquiry_messages");
    expect(eq).toHaveBeenCalledWith("inquiry_id", "inq-1");
    expect(order).toHaveBeenCalledWith("sent_at", { ascending: true });
    expect(result[0]).toEqual({
      id: "m1",
      direction: "outbound",
      authorEmail: "info@theplayplus.com",
      body: "첫 답변",
      gmailMessageId: "gm-1",
      rfcMessageId: "<a@theplayplus.com>",
      sentAt: "2026-09-01T00:00:00.000Z",
      autoSent: false,
    });
    expect(result[1].direction).toBe("inbound");
  });

  it("maps auto_sent so the timeline can mark macro replies", async () => {
    const { from } = mockSelect([{ ...rows[0], auto_sent: true }]);
    const result = await listMessages({ from } as never, "inq-1");
    expect(result[0].autoSent).toBe(true);
  });

  it("returns an empty array on error", async () => {
    const { from } = mockSelect(null, { message: "db" });
    await expect(listMessages({ from } as never, "inq-1")).resolves.toEqual([]);
  });
});

describe("listRfcMessageIds / listGmailMessageIds", () => {
  it("collects only the ids that exist", async () => {
    const { from } = mockSelect(rows);
    await expect(listRfcMessageIds({ from } as never, "inq-1")).resolves.toEqual(["<a@theplayplus.com>"]);
    await expect(listGmailMessageIds({ from } as never, "inq-1")).resolves.toEqual(new Set(["gm-1", "gm-2"]));
  });
});

describe("createOutboundMessage", () => {
  it("inserts an outbound row with the admin's email", async () => {
    const { from, insert } = mockSelect([]);
    const ok = await createOutboundMessage({ from } as never, {
      inquiryId: "inq-1",
      author: { id: "u1", email: "info@theplayplus.com" },
      body: "답변",
      gmailMessageId: "gm-1",
      rfcMessageId: "<a@theplayplus.com>",
      sentAt: "2026-09-01T00:00:00.000Z",
    });

    expect(ok).toBe(true);
    expect(insert).toHaveBeenCalledWith({
      inquiry_id: "inq-1",
      direction: "outbound",
      author_email: "info@theplayplus.com",
      body: "답변",
      gmail_message_id: "gm-1",
      rfc_message_id: "<a@theplayplus.com>",
      sent_at: "2026-09-01T00:00:00.000Z",
      auto_sent: false,
    });
  });

  it("records an auto reply with no author and auto_sent set", async () => {
    const { from, insert } = mockSelect([]);
    const ok = await createOutboundMessage({ from } as never, {
      inquiryId: "inq-1",
      author: null,
      autoSent: true,
      body: "접수되었습니다",
      gmailMessageId: "gm-9",
      rfcMessageId: "<z@theplayplus.com>",
      sentAt: "2026-09-01T00:00:00.000Z",
    });

    expect(ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ author_email: null, auto_sent: true }));
  });

  it("returns false when the insert fails", async () => {
    const { from, insert } = mockSelect([]);
    insert.mockResolvedValue({ error: { message: "boom" } });
    await expect(
      createOutboundMessage({ from } as never, {
        inquiryId: "inq-1",
        author: { id: "u1", email: "a@b.c" },
        body: "x",
        gmailMessageId: null,
        rfcMessageId: null,
      })
    ).resolves.toBe(false);
  });
});

describe("createInboundMessage", () => {
  it("inserts an inbound row keyed by the Gmail message id", async () => {
    const { from, insert } = mockSelect([]);
    await createInboundMessage({ from } as never, {
      inquiryId: "inq-1",
      fromEmail: "user@example.com",
      body: "회신",
      gmailMessageId: "gm-2",
      rfcMessageId: null,
      sentAt: "2026-09-01T01:00:00.000Z",
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "inbound", author_email: "user@example.com", gmail_message_id: "gm-2" })
    );
  });
});
