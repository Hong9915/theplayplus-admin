import { describe, it, expect, vi, afterEach } from "vitest";
import { buildInquirySlackMessage, sendSlackMessage } from "@/lib/slack";

const inquiry = {
  gameName: "여신의 검",
  inquiryNo: "20260903-0012",
  groupLabel: "결제",
  typeLabel: "결제 오류",
  title: "결제했는데 다이아가 안 들어와요",
  gameAccount: "player#1234",
  detailUrl: "https://admin.theplayplus.com/inquiries/abc",
};

describe("buildInquirySlackMessage", () => {
  it("puts game, type and title in the fallback text", () => {
    const message = buildInquirySlackMessage(inquiry);
    expect(message.text).toBe("[여신의 검] 새 문의 · 결제 > 결제 오류 · 결제했는데 다이아가 안 들어와요");
  });

  it("links the detail page and lists inquiry number and account in the blocks", () => {
    const message = buildInquirySlackMessage(inquiry);
    const json = JSON.stringify(message.blocks);
    expect(json).toContain("https://admin.theplayplus.com/inquiries/abc");
    expect(json).toContain("20260903-0012");
    expect(json).toContain("player#1234");
    expect(json).toContain("*결제 > 결제 오류*");
  });

  it("falls back to placeholders when number and account are missing", () => {
    const message = buildInquirySlackMessage({ ...inquiry, inquiryNo: null, gameAccount: null });
    const json = JSON.stringify(message.blocks);
    expect(json).toContain("접수번호 없음");
    expect(json).toContain("계정 없음");
  });
});

describe("sendSlackMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the payload as JSON to the webhook url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendSlackMessage("https://hooks.slack.com/services/x", { text: "hi", blocks: [] });

    expect(fetchMock).toHaveBeenCalledWith("https://hooks.slack.com/services/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hi", blocks: [] }),
    });
  });

  it("throws when Slack responds with a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "invalid_payload" }));

    await expect(sendSlackMessage("https://hooks.slack.com/services/x", { text: "hi", blocks: [] })).rejects.toThrow(
      "Slack webhook failed: 400 invalid_payload"
    );
  });
});
