import { describe, it, expect, vi, beforeEach } from "vitest";

const list = vi.fn();
const get = vi.fn();
const attachmentsGet = vi.fn();
const gmailFactory = vi.fn(() => ({ users: { messages: { list, get, attachments: { get: attachmentsGet } } } }));

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    gmail: () => gmailFactory(),
  },
}));

import { extractImageAttachments, openMailbox } from "@/lib/gmail";

function encode(text: string) {
  return Buffer.from(text, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

function message(id: string, threadId: string, from: string, body: string) {
  return {
    data: {
      id,
      threadId,
      internalDate: "1757200000000",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: from },
          { name: "Message-ID", value: `<${id}@example.com>` },
        ],
        body: { data: encode(body) },
      },
    },
  };
}

const SINCE = new Date("2026-09-07T00:00:00.000Z");

describe("openMailbox", () => {
  beforeEach(() => {
    list.mockReset();
    get.mockReset();
    gmailFactory.mockClear();
    process.env.GMAIL_CLIENT_ID = "cid";
    process.env.GMAIL_CLIENT_SECRET = "secret";
    process.env.GMAIL_REFRESH_TOKEN = "token";
    process.env.GMAIL_SENDER = "help@theplayplus.com";
    delete process.env.GMAIL_SERVICE_REFRESH_TOKEN;
    delete process.env.GMAIL_SERVICE_SENDER;
  });

  it("exposes the sender address of the mailbox", () => {
    expect(openMailbox("game").sender).toBe("help@theplayplus.com");
  });

  it("builds one Gmail client for the whole reader", async () => {
    list.mockResolvedValue({ data: { messages: [{ id: "m1", threadId: "t1" }] } });
    get.mockResolvedValue(message("m1", "t1", "a@example.com", "하나"));
    const reader = openMailbox("game");

    await reader.listInboundIdsSince(SINCE);
    await reader.getInboundMessage("m1");
    await reader.getInboundMessage("m1");

    expect(gmailFactory).toHaveBeenCalledTimes(1);
  });

  describe("listInboundIdsSince", () => {
    it("searches for mail received after the given time, excluding our own sender", async () => {
      list.mockResolvedValue({ data: { messages: [] } });

      await openMailbox("game").listInboundIdsSince(SINCE);

      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "me", q: "after:1788739200 -from:help@theplayplus.com" })
      );
    });

    it("returns message and thread ids without fetching bodies", async () => {
      list.mockResolvedValue({ data: { messages: [{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t2" }] } });

      const result = await openMailbox("game").listInboundIdsSince(SINCE);

      expect(result).toEqual([
        { id: "m1", threadId: "t1" },
        { id: "m2", threadId: "t2" },
      ]);
      expect(get).not.toHaveBeenCalled();
    });

    it("follows nextPageToken until the listing ends", async () => {
      list
        .mockResolvedValueOnce({ data: { messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "p2" } })
        .mockResolvedValueOnce({ data: { messages: [{ id: "m2", threadId: "t2" }] } });

      const result = await openMailbox("game").listInboundIdsSince(SINCE);

      expect(list).toHaveBeenCalledTimes(2);
      expect(list.mock.calls[1][0]).toEqual(expect.objectContaining({ pageToken: "p2" }));
      expect(result.map((entry) => entry.id)).toEqual(["m1", "m2"]);
    });
  });

  describe("getReplyHeaders", () => {
    it("reads In-Reply-To and References without the body", async () => {
      get.mockResolvedValue({
        data: {
          id: "m1",
          threadId: "m1",
          payload: {
            headers: [
              { name: "In-Reply-To", value: "<b@mail.gmail.com>" },
              { name: "References", value: "<a@mail.gmail.com>\r\n <b@mail.gmail.com>" },
            ],
          },
        },
      });

      const result = await openMailbox("game").getReplyHeaders("m1");

      expect(get).toHaveBeenCalledWith({
        userId: "me",
        id: "m1",
        format: "metadata",
        metadataHeaders: ["In-Reply-To", "References"],
      });
      expect(result).toEqual(["<b@mail.gmail.com>", "<a@mail.gmail.com>"]);
    });

    it("returns an empty list for mail that replies to nothing", async () => {
      get.mockResolvedValue({ data: { id: "m1", threadId: "m1", payload: { headers: [] } } });

      expect(await openMailbox("game").getReplyHeaders("m1")).toEqual([]);
    });
  });

  describe("getInboundMessage", () => {
    it("returns the message with its thread id and cleaned body", async () => {
      get.mockResolvedValue(message("m1", "t1", "User <user@example.com>", "회신 본문\n\nOn Mon wrote:\n> 인용"));

      const result = await openMailbox("game").getInboundMessage("m1");

      expect(get).toHaveBeenCalledWith({ userId: "me", id: "m1", format: "full" });
      expect(result).toEqual({
        gmailMessageId: "m1",
        threadId: "t1",
        rfcMessageId: "<m1@example.com>",
        fromEmail: "user@example.com",
        body: "회신 본문",
        sentAt: "2025-09-06T23:06:40.000Z",
        attachments: [],
      });
    });

    it("returns null for mail that still comes from our own sender", async () => {
      get.mockResolvedValue(message("m1", "t1", "THE PLAY+ <help@theplayplus.com>", "우리가 보낸 것"));

      expect(await openMailbox("game").getInboundMessage("m1")).toBeNull();
    });
  });
});

describe("reply photos", () => {
  it("picks image parts with an attachment id, attached or inline, and keeps photos over 5MB (shrunk on save) but drops other files and ones over 25MB", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/related",
          parts: [
            { mimeType: "text/html", body: { data: encode("<p>본문</p>") } },
            { mimeType: "image/png", filename: "image.png", body: { attachmentId: "inline-1", size: 1200 } },
          ],
        },
        { mimeType: "image/jpeg", filename: "화면.jpg", body: { attachmentId: "att-1", size: 5000 } },
        { mimeType: "application/pdf", filename: "log.pdf", body: { attachmentId: "att-2", size: 100 } },
        { mimeType: "image/png", filename: "big.png", body: { attachmentId: "att-3", size: 6 * 1024 * 1024 } },
        { mimeType: "image/png", filename: "huge.png", body: { attachmentId: "att-5", size: 26 * 1024 * 1024 } },
        { mimeType: "image/heic", filename: "iphone.heic", body: { attachmentId: "att-4", size: 100 } },
      ],
    };
    expect(extractImageAttachments(payload)).toEqual([
      { attachmentId: "att-1", filename: "화면.jpg", mimeType: "image/jpeg", size: 5000 },
      { attachmentId: "att-3", filename: "big.png", mimeType: "image/png", size: 6 * 1024 * 1024 },
      { attachmentId: "inline-1", filename: "image.png", mimeType: "image/png", size: 1200 },
    ]);
  });

  it("downloads an attachment's bytes through the reader", async () => {
    process.env.GMAIL_CLIENT_ID = "cid";
    process.env.GMAIL_CLIENT_SECRET = "secret";
    process.env.GMAIL_REFRESH_TOKEN = "token";
    process.env.GMAIL_SENDER = "help@theplayplus.com";
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff]);
    attachmentsGet.mockResolvedValue({
      data: { data: bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") },
    });

    const data = await openMailbox("game").getAttachment("m1", "att-1");

    expect(attachmentsGet).toHaveBeenCalledWith({ userId: "me", messageId: "m1", id: "att-1" });
    expect(data.equals(bytes)).toBe(true);
  });
});
