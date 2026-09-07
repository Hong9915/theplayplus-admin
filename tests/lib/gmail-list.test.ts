import { describe, it, expect, vi, beforeEach } from "vitest";

const list = vi.fn();
const get = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    gmail: () => ({ users: { messages: { list, get } } }),
  },
}));

import { listInboundSince } from "@/lib/gmail";

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

describe("listInboundSince", () => {
  beforeEach(() => {
    list.mockReset();
    get.mockReset();
    process.env.GMAIL_CLIENT_ID = "cid";
    process.env.GMAIL_CLIENT_SECRET = "secret";
    process.env.GMAIL_REFRESH_TOKEN = "token";
    process.env.GMAIL_SENDER = "help@theplayplus.com";
    delete process.env.GMAIL_SERVICE_REFRESH_TOKEN;
    delete process.env.GMAIL_SERVICE_SENDER;
  });

  it("searches for mail received after the given time, excluding our own sender", async () => {
    list.mockResolvedValue({ data: { messages: [] } });

    await listInboundSince("game", new Date("2026-09-07T00:00:00.000Z"));

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "me",
        q: "after:1788739200 -from:help@theplayplus.com",
      })
    );
  });

  it("returns each message with its thread id and cleaned body", async () => {
    list.mockResolvedValue({ data: { messages: [{ id: "m1" }] } });
    get.mockResolvedValue(message("m1", "t1", "User <user@example.com>", "회신 본문\n\nOn Mon wrote:\n> 인용"));

    const result = await listInboundSince("game", new Date("2026-09-07T00:00:00.000Z"));

    expect(get).toHaveBeenCalledWith({ userId: "me", id: "m1", format: "full" });
    expect(result).toEqual([
      {
        gmailMessageId: "m1",
        threadId: "t1",
        rfcMessageId: "<m1@example.com>",
        fromEmail: "user@example.com",
        body: "회신 본문",
        sentAt: "2025-09-06T23:06:40.000Z",
      },
    ]);
  });

  it("follows nextPageToken until the listing ends", async () => {
    list
      .mockResolvedValueOnce({ data: { messages: [{ id: "m1" }], nextPageToken: "p2" } })
      .mockResolvedValueOnce({ data: { messages: [{ id: "m2" }] } });
    get
      .mockResolvedValueOnce(message("m1", "t1", "a@example.com", "하나"))
      .mockResolvedValueOnce(message("m2", "t2", "b@example.com", "둘"));

    const result = await listInboundSince("game", new Date("2026-09-07T00:00:00.000Z"));

    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1][0]).toEqual(expect.objectContaining({ pageToken: "p2" }));
    expect(result.map((email) => email.gmailMessageId)).toEqual(["m1", "m2"]);
  });

  it("drops messages that still come from our own sender", async () => {
    list.mockResolvedValue({ data: { messages: [{ id: "m1" }] } });
    get.mockResolvedValue(message("m1", "t1", "THE PLAY+ <help@theplayplus.com>", "우리가 보낸 것"));

    const result = await listInboundSince("game", new Date("2026-09-07T00:00:00.000Z"));

    expect(result).toEqual([]);
  });
});
