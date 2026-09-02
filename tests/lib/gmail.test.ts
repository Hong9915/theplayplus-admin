import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();
const threadGetMock = vi.fn();
const setCredentialsMock = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: setCredentialsMock })),
    },
    gmail: vi.fn(() => ({ users: { messages: { send: sendMock }, threads: { get: threadGetMock } } })),
  },
}));

describe("sendReplyEmail", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset().mockResolvedValue({ data: { id: "gm-1", threadId: "thread-1" } });
    threadGetMock.mockReset();
    setCredentialsMock.mockReset();
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_REFRESH_TOKEN = "refresh-token";
    process.env.GMAIL_SENDER = "info@theplayplus.com";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when Gmail environment variables are missing", async () => {
    delete process.env.GMAIL_REFRESH_TOKEN;
    const { sendReplyEmail } = await import("@/lib/gmail");
    await expect(sendReplyEmail({ to: "a@b.com", subject: "s", body: "b" })).rejects.toThrow(/GMAIL_REFRESH_TOKEN/);
  });

  it("sends a base64url-encoded RFC 2822 message via the Gmail API", async () => {
    const { sendReplyEmail } = await import("@/lib/gmail");
    await sendReplyEmail({ to: "user@example.com", subject: "답변입니다", body: "본문 내용" });

    expect(setCredentialsMock).toHaveBeenCalledWith({ refresh_token: "refresh-token" });
    expect(sendMock).toHaveBeenCalledTimes(1);

    const call = sendMock.mock.calls[0][0];
    expect(call.userId).toBe("me");

    const decoded = Buffer.from(
      call.requestBody.raw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf-8");
    expect(decoded).toContain("From: info@theplayplus.com");
    expect(decoded).toContain("To: user@example.com");
    expect(decoded).toContain("본문 내용");
    expect(decoded).toMatch(/Message-ID: <[0-9a-f-]+@theplayplus\.com>/);
    expect(decoded).not.toContain("In-Reply-To");
  });

  it("returns the Gmail ids and the Message-ID it generated", async () => {
    const { sendReplyEmail } = await import("@/lib/gmail");
    const sent = await sendReplyEmail({ to: "user@example.com", subject: "s", body: "b" });

    expect(sent.gmailMessageId).toBe("gm-1");
    expect(sent.gmailThreadId).toBe("thread-1");
    expect(sent.rfcMessageId).toMatch(/^<[0-9a-f-]+@theplayplus\.com>$/);
    expect(sendMock.mock.calls[0][0].requestBody.threadId).toBeUndefined();
  });

  it("threads a follow-up with In-Reply-To, References, and the Gmail threadId", async () => {
    const { sendReplyEmail } = await import("@/lib/gmail");
    await sendReplyEmail({
      to: "user@example.com",
      subject: "s",
      body: "b",
      threadId: "thread-1",
      references: ["<a@theplayplus.com>", "<b@mail.example>"],
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.requestBody.threadId).toBe("thread-1");
    const decoded = Buffer.from(call.requestBody.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    expect(decoded).toContain("In-Reply-To: <b@mail.example>");
    expect(decoded).toContain("References: <a@theplayplus.com> <b@mail.example>");
  });

  it("propagates an error when the Gmail API call fails", async () => {
    sendMock.mockRejectedValue(new Error("gmail down"));
    const { sendReplyEmail } = await import("@/lib/gmail");
    await expect(sendReplyEmail({ to: "a@b.com", subject: "s", body: "b" })).rejects.toThrow("gmail down");
  });
});

function b64url(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("extractPlainText", () => {
  it("prefers the text/plain part of a multipart message", async () => {
    const { extractPlainText } = await import("@/lib/gmail");
    const text = extractPlainText({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: b64url("<p>HTML</p>") } },
        { mimeType: "text/plain", body: { data: b64url("평문 본문") } },
      ],
    });
    expect(text).toBe("평문 본문");
  });

  it("falls back to stripped HTML when there is no plain part", async () => {
    const { extractPlainText } = await import("@/lib/gmail");
    const text = extractPlainText({
      mimeType: "text/html",
      body: { data: b64url("<div>첫 줄<br>둘째 줄 &amp; 끝</div>") },
    });
    expect(text).toBe("첫 줄\n둘째 줄 & 끝");
  });

  it("returns an empty string for an empty payload", async () => {
    const { extractPlainText } = await import("@/lib/gmail");
    expect(extractPlainText(undefined)).toBe("");
  });
});

describe("stripQuotedReply", () => {
  it("drops the quoted original below an English reply header", async () => {
    const { stripQuotedReply } = await import("@/lib/gmail");
    expect(
      stripQuotedReply("감사합니다, 해결됐어요.\n\nOn Tue, Sep 2, 2026 at 1:03 AM THE PLAY+ <info@theplayplus.com> wrote:\n> 안녕하세요")
    ).toBe("감사합니다, 해결됐어요.");
  });

  it("drops the quoted original below a Korean reply header", async () => {
    const { stripQuotedReply } = await import("@/lib/gmail");
    expect(stripQuotedReply("아직 안 됩니다.\n2026년 9월 2일 (화) THE PLAY+님이 작성:\n> 확인 후").toString()).toBe(
      "아직 안 됩니다."
    );
  });

  it("stops at the first quoted line", async () => {
    const { stripQuotedReply } = await import("@/lib/gmail");
    expect(stripQuotedReply("답장입니다\n> 원문\n> 원문2")).toBe("답장입니다");
  });

  it("keeps text that has no quote", async () => {
    const { stripQuotedReply } = await import("@/lib/gmail");
    expect(stripQuotedReply("그냥 본문\n두 줄")).toBe("그냥 본문\n두 줄");
  });
});

describe("fetchInboundReplies", () => {
  beforeEach(() => {
    vi.resetModules();
    threadGetMock.mockReset();
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_REFRESH_TOKEN = "refresh-token";
    process.env.GMAIL_SENDER = "info@theplayplus.com";
  });

  it("returns only messages not sent by us, with the quoted part removed", async () => {
    threadGetMock.mockResolvedValue({
      data: {
        messages: [
          {
            id: "gm-out",
            internalDate: "1756771380000",
            payload: {
              mimeType: "text/plain",
              headers: [{ name: "From", value: "THE PLAY+ <info@theplayplus.com>" }],
              body: { data: b64url("우리가 보낸 답변") },
            },
          },
          {
            id: "gm-in",
            internalDate: "1756774980000",
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "From", value: "User <user@example.com>" },
                { name: "Message-ID", value: "<u1@mail.example>" },
              ],
              body: { data: b64url("해결됐습니다 감사합니다\n\nOn ... wrote:\n> 우리가 보낸 답변") },
            },
          },
        ],
      },
    });
    const { fetchInboundReplies } = await import("@/lib/gmail");

    const inbound = await fetchInboundReplies("thread-1");

    expect(threadGetMock).toHaveBeenCalledWith({ userId: "me", id: "thread-1", format: "full" });
    expect(inbound).toEqual([
      {
        gmailMessageId: "gm-in",
        rfcMessageId: "<u1@mail.example>",
        fromEmail: "user@example.com",
        body: "해결됐습니다 감사합니다",
        sentAt: new Date(1756774980000).toISOString(),
      },
    ]);
  });

  it("propagates a Gmail failure so the route can report it", async () => {
    threadGetMock.mockRejectedValue(new Error("insufficient scope"));
    const { fetchInboundReplies } = await import("@/lib/gmail");
    await expect(fetchInboundReplies("thread-1")).rejects.toThrow("insufficient scope");
  });
});

describe("sendReplyEmail with an HTML body", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset().mockResolvedValue({ data: { id: "gm-1", threadId: "thread-1" } });
    setCredentialsMock.mockReset();
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_REFRESH_TOKEN = "refresh-token";
    process.env.GMAIL_SENDER = "info@theplayplus.com";
  });

  function decodeRaw(): string {
    const call = sendMock.mock.calls[0][0];
    return Buffer.from(call.requestBody.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  }

  it("sends multipart/alternative with the plain text first and the HTML base64-encoded", async () => {
    const { sendReplyEmail } = await import("@/lib/gmail");
    await sendReplyEmail({
      to: "user@example.com",
      subject: "s",
      body: "평문 본문",
      html: "<p>HTML 본문</p>",
    });

    const decoded = decodeRaw();
    expect(decoded).toMatch(/Content-Type: multipart\/alternative; boundary="[^"]+"/);
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decoded).toContain("평문 본문");
    expect(decoded).toContain("Content-Type: text/html; charset=UTF-8");
    expect(decoded).toContain("Content-Transfer-Encoding: base64");
    expect(decoded).toContain(Buffer.from("<p>HTML 본문</p>", "utf-8").toString("base64"));
    expect(decoded.indexOf("text/plain")).toBeLessThan(decoded.indexOf("text/html"));
  });

  it("wraps the HTML in multipart/related when inline images are attached", async () => {
    const { sendReplyEmail } = await import("@/lib/gmail");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await sendReplyEmail({
      to: "user@example.com",
      subject: "s",
      body: "평문",
      html: '<img src="cid:theplayplus-logo">',
      inlineImages: [{ cid: "theplayplus-logo", contentType: "image/png", filename: "logo.png", data: png }],
    });

    const decoded = decodeRaw();
    expect(decoded).toMatch(/Content-Type: multipart\/related; boundary="[^"]+"/);
    expect(decoded).toContain("Content-Type: image/png; name=\"logo.png\"");
    expect(decoded).toContain("Content-ID: <theplayplus-logo>");
    expect(decoded).toContain("Content-Disposition: inline; filename=\"logo.png\"");
    expect(decoded).toContain(png.toString("base64"));
    expect(decoded.indexOf("multipart/alternative")).toBeLessThan(decoded.indexOf("multipart/related"));
  });

  it("still sends plain text only when no HTML is given", async () => {
    const { sendReplyEmail } = await import("@/lib/gmail");
    await sendReplyEmail({ to: "user@example.com", subject: "s", body: "평문" });
    const decoded = decodeRaw();
    expect(decoded).not.toContain("multipart");
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
  });
});
