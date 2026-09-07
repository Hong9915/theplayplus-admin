import { describe, it, expect, vi, beforeEach } from "vitest";

const list = vi.fn();
const get = vi.fn();
const gmailFactory = vi.fn(() => ({ users: { messages: { list, get } } }));

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    gmail: () => gmailFactory(),
  },
}));

import { openMailbox } from "@/lib/gmail";

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
      });
    });

    it("returns null for mail that still comes from our own sender", async () => {
      get.mockResolvedValue(message("m1", "t1", "THE PLAY+ <help@theplayplus.com>", "우리가 보낸 것"));

      expect(await openMailbox("game").getInboundMessage("m1")).toBeNull();
    });
  });
});
