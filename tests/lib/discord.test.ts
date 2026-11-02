import { describe, it, expect, vi, afterEach } from "vitest";
import { buildInquiryDiscordMessage, buildLoungeDiscordMessage, escapeDiscord, sendDiscordMessage } from "@/lib/discord";
import type { LoungeItemRow } from "@/lib/lounge-items";

const inquiry = {
  gameName: "여신의 검",
  inquiryNo: "20260903-0012",
  groupLabel: "결제",
  typeLabel: "결제 오류",
  title: "결제했는데 다이아가 안 들어와요",
  content: "어제 12,000원 결제했는데\n다이아가 안 들어왔어요.",
  gameAccount: "player_1234",
  priority: "urgent",
  detailUrl: "https://admin.theplayplus.com/games/g/inquiries/abc",
};

function loungeItem(overrides: Partial<LoungeItemRow> = {}): LoungeItemRow {
  return {
    id: "i1", gameId: "g1", kind: "post", naverId: 1, feedId: 1, title: "버그 있어요", body: "로그인이 안 돼요",
    boardName: "자유게시판", nickname: "유저1", isUser: true, url: "https://game.naver.com/lounge/x/board/detail/1",
    postedAt: "2026-11-02T00:00:00.000Z", readAt: null, ...overrides,
  };
}

describe("escapeDiscord", () => {
  it("escapes markdown and mention characters", () => {
    expect(escapeDiscord("**굵게** _a_ `c` ||s|| [l](u)")).toBe("\\*\\*굵게\\*\\* \\_a\\_ \\`c\\` \\|\\|s\\|\\| \\[l\\]\\(u\\)");
  });
});

describe("buildInquiryDiscordMessage", () => {
  it("puts an urgent heading in content and a red embed linking the detail page", () => {
    const message = buildInquiryDiscordMessage(inquiry);
    expect(message.content).toBe("🚨 **[여신의 검] 긴급 문의**");
    const [embed] = message.embeds;
    expect(embed.color).toBe(0xe01e5a);
    expect(embed.title).toBe("결제했는데 다이아가 안 들어와요");
    expect(embed.url).toBe(inquiry.detailUrl);
    expect(embed.description).toBe("> 어제 12,000원 결제했는데\n> 다이아가 안 들어왔어요.");
    expect(embed.fields).toEqual([
      { name: "유형", value: "결제 › 결제 오류", inline: true },
      { name: "접수번호", value: "20260903-0012", inline: true },
      { name: "계정", value: "player\\_1234", inline: true },
    ]);
  });

  it("never lets user text ping @everyone", () => {
    const message = buildInquiryDiscordMessage({ ...inquiry, content: "@everyone 봐주세요" });
    expect(message.allowed_mentions).toEqual({ parse: [] });
  });

  it("uses a grey embed and plain heading for non-urgent (service) inquiries", () => {
    const message = buildInquiryDiscordMessage({ ...inquiry, gameName: "서비스 문의", priority: "normal" });
    expect(message.content).toBe("**[서비스 문의] 새 문의**");
    expect(message.embeds[0].color).toBe(0x8d9298);
  });

  it("clips long bodies to 600 characters and omits the description when empty", () => {
    const long = buildInquiryDiscordMessage({ ...inquiry, content: "가".repeat(700) });
    expect(long.embeds[0].description).toBe(`> ${"가".repeat(600)}…`);
    expect(buildInquiryDiscordMessage({ ...inquiry, content: "  " }).embeds[0].description).toBeUndefined();
  });

  it("fills placeholders for missing number and account", () => {
    const message = buildInquiryDiscordMessage({ ...inquiry, inquiryNo: null, gameAccount: null });
    expect(message.embeds[0].fields?.map((f) => f.value)).toEqual(["결제 › 결제 오류", "접수번호 없음", "계정 없음"]);
  });
});

describe("buildLoungeDiscordMessage", () => {
  it("makes one green embed per item with a link to the lounge post", () => {
    const message = buildLoungeDiscordMessage({ gameName: "숲의 소환단", items: [loungeItem(), loungeItem({ id: "i2", kind: "comment", title: "공지" })], listUrl: "https://admin/l" });
    expect(message.content).toBe("💬 **[숲의 소환단] 라운지 새 글 2건** · [관리자에서 보기](<https://admin/l>)");
    expect(message.embeds).toHaveLength(2);
    expect(message.embeds[0]).toEqual({
      color: 0x03c75a,
      author: { name: "[숲의 소환단] 라운지 새 글" },
      title: "버그 있어요",
      url: "https://game.naver.com/lounge/x/board/detail/1",
      description: "자유게시판 · 유저1\n> 로그인이 안 돼요",
    });
    expect(message.embeds[1].author?.name).toBe("[숲의 소환단] 라운지 새 댓글");
  });

  it("shows at most five items and counts the rest", () => {
    const items = Array.from({ length: 7 }, (_, i) => loungeItem({ id: `i${i}` }));
    const message = buildLoungeDiscordMessage({ gameName: "게임", items, listUrl: "https://admin/l" });
    expect(message.embeds).toHaveLength(5);
    expect(message.content).toContain("라운지 새 글 7건** · 외 2건");
  });
});

describe("sendDiscordMessage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts JSON to the webhook url", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const message = buildInquiryDiscordMessage(inquiry);
    await sendDiscordMessage("https://discord.com/api/webhooks/1/x", message);
    expect(fetchMock).toHaveBeenCalledWith("https://discord.com/api/webhooks/1/x", expect.objectContaining({ method: "POST", body: JSON.stringify(message) }));
  });

  it("throws with the status when Discord rejects the message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 400 })));
    await expect(sendDiscordMessage("https://x", buildInquiryDiscordMessage(inquiry))).rejects.toThrow("Discord webhook failed: 400 bad");
  });
});
