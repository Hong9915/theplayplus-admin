import { describe, it, expect, vi, afterEach } from "vitest";
import { buildInquirySlackMessage, sendSlackMessage } from "@/lib/slack";

const inquiry = {
  gameName: "여신의 검",
  inquiryNo: "20260903-0012",
  groupLabel: "결제",
  typeLabel: "결제 오류",
  title: "결제했는데 다이아가 안 들어와요",
  content: "어제 12,000원 결제했는데 다이아가 안 들어왔어요. 확인 부탁드립니다.",
  gameAccount: "player#1234",
  priority: "urgent",
  detailUrl: "https://admin.theplayplus.com/inquiries/abc",
};

type Block = { type: string; text?: { text: string } };

function blocksOf(message: ReturnType<typeof buildInquirySlackMessage>): Block[] {
  return message.attachments[0].blocks as Block[];
}

function jsonOf(message: ReturnType<typeof buildInquirySlackMessage>): string {
  return JSON.stringify(message.attachments[0].blocks);
}

describe("buildInquirySlackMessage", () => {
  it("puts game, type and title in the fallback text", () => {
    const message = buildInquirySlackMessage(inquiry);
    expect(message.text).toBe("[여신의 검] 긴급 문의 · 결제 > 결제 오류 · 결제했는데 다이아가 안 들어와요");
  });

  it("links the detail page and lists inquiry number and account in the blocks", () => {
    const json = jsonOf(buildInquirySlackMessage(inquiry));
    expect(json).toContain("https://admin.theplayplus.com/inquiries/abc");
    expect(json).toContain("20260903-0012");
    expect(json).toContain("player#1234");
    expect(json).toContain("*결제 > 결제 오류*");
  });

  it("falls back to placeholders when number and account are missing", () => {
    const json = jsonOf(buildInquirySlackMessage({ ...inquiry, inquiryNo: null, gameAccount: null }));
    expect(json).toContain("접수번호 없음");
    expect(json).toContain("계정 없음");
  });

  it("colors urgent inquiries red and marks them in the header", () => {
    const message = buildInquirySlackMessage(inquiry);
    expect(message.attachments[0].color).toBe("#E01E5A");
    expect(jsonOf(message)).toContain("🚨 *[여신의 검] 긴급 문의*");
  });

  it("uses a muted color and a plain header for non-urgent inquiries", () => {
    const message = buildInquirySlackMessage({ ...inquiry, gameName: "서비스 문의", priority: "normal" });
    expect(message.attachments[0].color).toBe("#8D9298");
    expect(message.text).toBe("[서비스 문의] 새 문의 · 결제 > 결제 오류 · 결제했는데 다이아가 안 들어와요");
    expect(jsonOf(message)).toContain("*[서비스 문의] 새 문의*");
    expect(jsonOf(message)).not.toContain("🚨");
  });

  it("quotes the inquiry body so it reads as the user's own text", () => {
    const blocks = blocksOf(buildInquirySlackMessage({ ...inquiry, content: "첫 줄\n둘째 줄" }));
    expect(blocks[1].text?.text).toBe("> 첫 줄\n> 둘째 줄");
  });

  it("truncates a long body instead of flooding the channel", () => {
    const blocks = blocksOf(buildInquirySlackMessage({ ...inquiry, content: "가".repeat(900) }));
    expect(blocks[1].text?.text).toBe(`> ${"가".repeat(600)}…`);
  });

  it("escapes Slack control characters in user-supplied text", () => {
    const json = jsonOf(buildInquirySlackMessage({ ...inquiry, title: "<b>환불</b> & 문의", content: "a < b & c > d" }));
    expect(json).toContain("&lt;b&gt;환불&lt;/b&gt; &amp; 문의");
    expect(json).toContain("a &lt; b &amp; c &gt; d");
  });

  it("omits the body block when the inquiry has no content", () => {
    const blocks = blocksOf(buildInquirySlackMessage({ ...inquiry, content: null }));
    expect(blocks).toHaveLength(2);
    expect(blocks[1].type).toBe("context");
  });

  it("omits the body block when the content is only whitespace", () => {
    expect(blocksOf(buildInquirySlackMessage({ ...inquiry, content: "  \n " }))).toHaveLength(2);
  });
});

describe("sendSlackMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the payload as JSON to the webhook url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const message = { text: "hi", attachments: [{ color: "#E01E5A", blocks: [] }] };

    await sendSlackMessage("https://hooks.slack.com/services/x", message);

    expect(fetchMock).toHaveBeenCalledWith("https://hooks.slack.com/services/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  });

  it("throws when Slack responds with a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "invalid_payload" }));
    const message = { text: "hi", attachments: [{ color: "#E01E5A", blocks: [] }] };

    await expect(sendSlackMessage("https://hooks.slack.com/services/x", message)).rejects.toThrow(
      "Slack webhook failed: 400 invalid_payload"
    );
  });
});
