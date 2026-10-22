import { describe, it, expect, vi, afterEach } from "vitest";
import { parseLoungeId, fetchLoungePosts, fetchLoungeComments, parseLoungePostUrl, fetchBoardPostsOf } from "@/lib/naver-lounge";

function stubFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const contents = JSON.stringify({
  document: {
    components: [
      { "@ctype": "sticker" },
      { "@ctype": "text", value: [
        { "@ctype": "paragraph", nodes: [{ "@ctype": "textNode", value: "첫 줄" }, { "@ctype": "textNode", value: "입니다" }] },
        { "@ctype": "paragraph", nodes: [{ "@ctype": "textNode", value: "둘째 줄" }] },
      ] },
    ],
  },
});

const feedResponse = {
  code: 200,
  content: {
    feeds: [
      {
        feed: { feedId: 8212525, title: "&#x1f430; 다른 게임 &amp; 맞죠?", contents, createdDate: "20260919215348" },
        user: { nickname: "게임달고나", userRoleCode: "common_user" },
        comment: { totalCount: 2 },
        feedLink: { pc: "https://game.naver.com/lounge/L1/board/detail/8212525" },
        board: { boardName: "창업자들의 토크" },
      },
      {
        feed: { feedId: 8207656, title: "[안내] 오픈안내", contents: "깨진 JSON", createdDate: "20260918174755" },
        user: { nickname: "토크", userRoleCode: "game_manager" },
        comment: { totalCount: 0 },
        feedLink: { pc: "https://game.naver.com/lounge/L1/board/detail/8207656" },
        board: null,
      },
    ],
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("parseLoungeId", () => {
  it("pulls the id out of pc and mobile lounge urls", () => {
    expect(parseLoungeId("https://game.naver.com/lounge/Tukiers_God_Tier_Life_Idle_Tycoon/home")).toBe("Tukiers_God_Tier_Life_Idle_Tycoon");
    expect(parseLoungeId("https://m.game.naver.com/lounge/Abc_123/board/detail/1?x=1")).toBe("Abc_123");
  });
  it("accepts a bare id and trims it", () => {
    expect(parseLoungeId("  Abc_123 ")).toBe("Abc_123");
  });
  it("rejects other hosts, other paths, and junk", () => {
    expect(parseLoungeId("https://example.com/lounge/Abc/home")).toBeNull();
    expect(parseLoungeId("https://game.naver.com/esports")).toBeNull();
    expect(parseLoungeId("한글 아이디")).toBeNull();
    expect(parseLoungeId("")).toBeNull();
  });
});

describe("fetchLoungePosts", () => {
  it("maps the feed response", async () => {
    const fetchMock = stubFetch(feedResponse);
    const posts = await fetchLoungePosts("L1");
    expect(fetchMock.mock.calls[0][0]).toContain("/community/lounge/L1/feed?");
    expect(fetchMock.mock.calls[0][0]).toContain("limit=30");
    expect(fetchMock.mock.calls[0][1].headers.Referer).toBe("https://game.naver.com/");
    expect(posts[0]).toEqual({
      feedId: 8212525,
      title: "🐰 다른 게임 & 맞죠?",
      bodyText: "첫 줄입니다\n둘째 줄",
      boardName: "창업자들의 토크",
      nickname: "게임달고나",
      isUser: true,
      postedAt: "2026-09-19T12:53:48.000Z",
      url: "https://game.naver.com/lounge/L1/board/detail/8212525",
      commentCount: 2,
    });
    // 본문 JSON이 깨져도 글은 살린다. GM 글은 isUser=false.
    expect(posts[1]).toMatchObject({ feedId: 8207656, bodyText: "", isUser: false, boardName: null, commentCount: 0 });
  });
  it("keeps the title as is when an entity is out of range instead of failing the whole lounge", async () => {
    stubFetch({ content: { feeds: [{ ...feedResponse.content.feeds[0], feed: { ...feedResponse.content.feeds[0].feed, title: "범위 밖 &#x110000; &#99999999; &amp;" } }] } });
    const posts = await fetchLoungePosts("L1");
    expect(posts[0].title).toBe("범위 밖 &#x110000; &#99999999; &");
  });

  it("drops a post link that is not https and falls back to the lounge itself", async () => {
    const link = (pc: string) => ({ ...feedResponse.content.feeds[0], feedLink: { pc } });
    stubFetch({ content: { feeds: [link("javascript:alert(1)"), link("//game.naver.com/lounge/L1/board/detail/1")] } });
    const posts = await fetchLoungePosts("L1");
    expect(posts[0].url).toBe("https://game.naver.com/lounge/L1");
    expect(posts[1].url).toBe("https://game.naver.com/lounge/L1");
  });

  it("throws on a non-ok response and on an unexpected shape", async () => {
    stubFetch({}, false);
    await expect(fetchLoungePosts("L1")).rejects.toThrow();
    stubFetch({ content: { feeds: [{ feed: {} }] } });
    await expect(fetchLoungePosts("L1")).rejects.toThrow();
  });
});

describe("fetchLoungeComments", () => {
  const comment = (over: Record<string, unknown>, user: Record<string, unknown>, replies: unknown[] = []) => ({
    comment: { commentId: 1, content: "내용", createdDate: "20260921030329", secret: false, deleted: false, attaches: null, ...over },
    user: { userNickname: "유저", userRoleCode: "common_user", ...user },
    replyComments: replies,
  });

  it("flattens replies and handles secret, deleted, and sticker-only comments", async () => {
    const fetchMock = stubFetch({
      content: {
        comments: {
          data: [
            comment({ commentId: 10, content: "GM 답변" }, { userNickname: "토크", userRoleCode: "game_manager" }, [
              comment({ commentId: 11, content: "", attaches: [{ attachType: "STICKER" }] }, {}),
            ]),
            comment({ commentId: 12, secret: true, content: "숨김" }, {}),
            comment({ commentId: 13, deleted: true }, {}),
          ],
        },
      },
    });
    const comments = await fetchLoungeComments("L1", 8212525);
    expect(fetchMock.mock.calls[0][0]).toContain("/type/FEED/id/8212525/comments?");
    expect(fetchMock.mock.calls[0][0]).toContain("originalLoungeId=L1");
    expect(comments).toEqual([
      { commentId: 10, feedId: 8212525, bodyText: "GM 답변", nickname: "토크", isUser: false, postedAt: "2026-09-20T18:03:29.000Z" },
      { commentId: 11, feedId: 8212525, bodyText: "(스티커·이미지)", nickname: "유저", isUser: true, postedAt: "2026-09-20T18:03:29.000Z" },
      { commentId: 12, feedId: 8212525, bodyText: "(비밀 댓글)", nickname: "유저", isUser: true, postedAt: "2026-09-20T18:03:29.000Z" },
    ]);
  });
});

describe("parseLoungePostUrl", () => {
  it("pulls the lounge id and post number out of a pc or mobile post url", () => {
    expect(parseLoungePostUrl("https://game.naver.com/lounge/Tree_World/board/detail/8347086")).toEqual({ loungeId: "Tree_World", feedId: 8347086 });
    expect(parseLoungePostUrl(" https://m.game.naver.com/lounge/Abc_1/board/detail/12?x=1 ")).toEqual({ loungeId: "Abc_1", feedId: 12 });
  });
  it("rejects lounge homes, other hosts, and non-https urls", () => {
    expect(parseLoungePostUrl("https://game.naver.com/lounge/Tree_World/home")).toBeNull();
    expect(parseLoungePostUrl("https://example.com/lounge/A/board/detail/1")).toBeNull();
    expect(parseLoungePostUrl("http://game.naver.com/lounge/A/board/detail/1")).toBeNull();
  });
});

describe("fetchBoardPostsOf", () => {
  it("looks up the post's board and reads that board's posts with plain-text bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ feedId: 8347086, boardId: 23, boardName: null }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(feedResponse) });
    vi.stubGlobal("fetch", fetchMock);

    const posts = await fetchBoardPostsOf("L1", 8347086);

    expect(fetchMock.mock.calls[0][0]).toBe("https://comm-api.game.naver.com/nng_main/v1/community/feed/8347086");
    expect(fetchMock.mock.calls[1][0]).toContain("/lounge/L1/feed?boardId=23&");
    expect(posts[0]).toEqual({
      feedId: 8212525,
      title: "🐰 다른 게임 & 맞죠?",
      bodyText: "첫 줄입니다\n둘째 줄",
      postedAt: "2026-09-19T12:53:48.000Z",
      url: "https://game.naver.com/lounge/L1/board/detail/8212525",
    });
    expect(posts[1].bodyText).toBe("");
  });

  it("throws when the post lookup fails so the sync keeps stored chunks", async () => {
    stubFetch({}, false);
    await expect(fetchBoardPostsOf("L1", 1)).rejects.toThrow("naver lounge request failed: 500");
  });
});
