import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();
const setCredentialsMock = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: setCredentialsMock })),
    },
    gmail: vi.fn(() => ({ users: { messages: { send: sendMock } } })),
  },
}));

describe("sendReplyEmail", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset().mockResolvedValue({});
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
  });

  it("propagates an error when the Gmail API call fails", async () => {
    sendMock.mockRejectedValue(new Error("gmail down"));
    const { sendReplyEmail } = await import("@/lib/gmail");
    await expect(sendReplyEmail({ to: "a@b.com", subject: "s", body: "b" })).rejects.toThrow("gmail down");
  });
});
