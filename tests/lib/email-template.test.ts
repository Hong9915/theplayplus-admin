import { describe, it, expect } from "vitest";
import { escapeHtml, renderReplyEmailHtml, renderReplyEmailText } from "@/lib/email-template";

const base = {
  gameName: "여신키우기",
  gameAccount: "mahamaster",
  replyBody: "안녕하세요.\n\n재지급해 드렸습니다.",
  inquiry: {
    inquiryNo: "TP-20260901-0042",
    groupLabel: "게임 이용 문의",
    typeLabel: "결제/환불",
    title: "아이템이 안 들어왔어요",
    content: "결제했는데\n우편함이 비어 있어요",
  },
  logoCid: "theplayplus-logo",
  contactUrl: "https://www.theplayplus.com/",
  contactEmail: "help@theplayplus.com",
};

describe("escapeHtml", () => {
  it("escapes the characters that would break markup", () => {
    expect(escapeHtml(`<b>"a" & 'b'</b>`)).toBe("&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;");
  });
});

describe("renderReplyEmailHtml", () => {
  it("puts the game name, greeting, and reply body in the template", () => {
    const html = renderReplyEmailHtml(base);
    expect(html).toContain("여신키우기 고객센터");
    expect(html).toContain("<strong");
    expect(html).toContain("mahamaster");
    expect(html).toContain("안녕하세요.<br><br>재지급해 드렸습니다.");
  });

  it("references the logo by its Content-ID", () => {
    expect(renderReplyEmailHtml(base)).toContain('src="cid:theplayplus-logo"');
  });

  it("echoes the original inquiry with its number, type, account, title, and content", () => {
    const html = renderReplyEmailHtml(base);
    expect(html).toContain("TP-20260901-0042");
    expect(html).toContain("게임 이용 문의 · 결제/환불");
    expect(html).toContain("아이템이 안 들어왔어요");
    expect(html).toContain("결제했는데<br>우편함이 비어 있어요");
  });

  it("escapes user-controlled text so it cannot inject markup", () => {
    const html = renderReplyEmailHtml({
      ...base,
      gameAccount: "<script>alert(1)</script>",
      replyBody: "a < b & c",
      inquiry: { ...base.inquiry, title: "<img src=x>", content: "x" },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &lt; b &amp; c");
    expect(html).not.toContain("<img src=x>");
  });

  it("greets a generic customer when there is no game account", () => {
    const html = renderReplyEmailHtml({ ...base, gameAccount: null });
    expect(html).toContain("고객님");
    expect(html).not.toContain("null");
  });

  it("omits the rows that have no value", () => {
    const html = renderReplyEmailHtml({
      ...base,
      inquiry: { ...base.inquiry, inquiryNo: null, groupLabel: null, typeLabel: null },
      gameAccount: null,
    });
    expect(html).not.toContain("접수번호");
    expect(html).not.toContain("문의 유형");
    expect(html).not.toContain("게임 계정");
  });

  it("links to the contact page and prints the company footer", () => {
    const html = renderReplyEmailHtml(base);
    expect(html).toContain('href="https://www.theplayplus.com/"');
    expect(html).toContain("주식회사 더플레이플러스");
    expect(html).toContain("847-81-03647");
    expect(html).toContain("help@theplayplus.com");
    expect(html).not.toContain("info@theplayplus.com");
  });

  it("prints whichever contact address it is given", () => {
    const html = renderReplyEmailHtml({ ...base, contactEmail: "info@theplayplus.com" });
    expect(html).toContain("info@theplayplus.com");
  });
});

describe("renderReplyEmailText", () => {
  it("keeps the reply body first and appends the quoted inquiry", () => {
    const text = renderReplyEmailText(base);
    expect(text.startsWith("안녕하세요.\n\n재지급해 드렸습니다.")).toBe(true);
    expect(text).toContain("[고객님께서 문의하신 내용]");
    expect(text).toContain("접수번호: TP-20260901-0042");
    expect(text).toContain("제목: 아이템이 안 들어왔어요");
    expect(text).toContain("help@theplayplus.com");
  });
});
