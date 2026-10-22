import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  POLICY_CHUNK_MAX_CHARS,
  chunkPolicyText,
  policyEmbeddingText,
  policyHash,
  searchPolicyChunks,
  syncAllPolicies,
} from "@/lib/policies";
import * as loungeModule from "@/lib/naver-lounge";
import * as embeddingsModule from "@/lib/embeddings";
import type { LoungeBoardPost } from "@/lib/naver-lounge";

// parseLoungePostUrl은 순수 함수라 실제 구현을 쓴다.
vi.mock("@/lib/naver-lounge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/naver-lounge")>();
  return { ...actual, fetchBoardPostsOf: vi.fn() };
});
vi.mock("@/lib/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/embeddings")>();
  return { ...actual, embedTexts: vi.fn() };
});

type Row = Record<string, unknown>;

/** 동기화가 쓰는 만큼만 흉내 낸 메모리 DB. select·delete에 eq/in/not/gte 조건, upsert는 유니크 키로 덮어쓴다. */
function fakeSupabase(initial: { game_pages?: Row[]; policy_chunks?: Row[] }, failSelectOf?: string) {
  const db: Record<string, Row[]> = { game_pages: [...(initial.game_pages ?? [])], policy_chunks: [...(initial.policy_chunks ?? [])] };
  function from(table: string) {
    let op: "select" | "delete" = "select";
    const filters: Array<(row: Row) => boolean> = [];
    const builder = {
      select: () => builder,
      delete: () => {
        op = "delete";
        return builder;
      },
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      gte: (column: string, value: number) => (filters.push((row) => (row[column] as number) >= value), builder),
      not: (column: string) => (filters.push((row) => row[column] !== null && row[column] !== undefined), builder),
      upsert: (rows: Row[], options: { onConflict: string }) => {
        const keys = options.onConflict.split(",");
        for (const row of rows) {
          const index = db[table].findIndex((existing) => keys.every((key) => existing[key] === row[key]));
          if (index === -1) db[table].push(row);
          else db[table][index] = row;
        }
        return Promise.resolve({ error: null });
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        const matched = db[table].filter((row) => filters.every((filter) => filter(row)));
        if (op === "delete") {
          db[table] = db[table].filter((row) => !matched.includes(row));
          return Promise.resolve({ error: null }).then(resolve, reject);
        }
        if (failSelectOf === table) return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
        return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }
  return { client: { from } as never, db };
}

const POLICY_URL = "https://game.naver.com/lounge/Tree_World/board/detail/8347086";
const GAME = "game-1";

function post(feedId: number, title: string, bodyText: string): LoungeBoardPost {
  return { feedId, title, bodyText, postedAt: "2026-10-21T00:00:00.000Z", url: `https://game.naver.com/lounge/Tree_World/board/detail/${feedId}` };
}

const refund = post(8347098, "[숲의 소환단] 환불 정책 안내", "[1] 법적 근거\n7일 이내 청약철회 가능\n\n[2] 자체 환불\n고객센터로 문의");
const terms = post(8347086, "[숲의 소환단] 서비스 이용 약관", "제1조 (목적)\n이 약관은 …");

/** 받은 글 수만큼 길이 1536짜리 벡터를 돌려준다. 값은 글자 수로 구분한다. */
function mockEmbeddings() {
  vi.mocked(embeddingsModule.embedTexts).mockImplementation(async (texts) => texts.map((text) => new Array(1536).fill(text.length)));
}

describe("chunkPolicyText", () => {
  it("keeps a short body as one chunk without blank lines", () => {
    expect(chunkPolicyText("[1] 법적 근거\n\n7일 이내 청약철회\n")).toEqual(["[1] 법적 근거\n7일 이내 청약철회"]);
  });

  it("returns no chunks for an empty body", () => {
    expect(chunkPolicyText(" \n\n ")).toEqual([]);
  });

  it("packs paragraphs up to the limit and never exceeds it", () => {
    const paragraph = "가".repeat(300);
    const chunks = chunkPolicyText([paragraph, paragraph, paragraph, paragraph, paragraph].join("\n"));
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(POLICY_CHUNK_MAX_CHARS));
    expect(chunks[0]).toBe(`${paragraph}\n${paragraph}`);
  });

  it("repeats a short heading that ends a chunk at the start of the next one", () => {
    const long = "나".repeat(700);
    const chunks = chunkPolicyText(["다".repeat(90), "[2] 자체 환불", long].join("\n"));
    expect(chunks).toEqual([`${"다".repeat(90)}\n[2] 자체 환불`, `[2] 자체 환불\n${long}`]);
  });

  it("splits a paragraph longer than the limit with overlap", () => {
    const text = Array.from({ length: 2000 }, (_, i) => String(i % 10)).join("");
    const chunks = chunkPolicyText(text);
    chunks.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(POLICY_CHUNK_MAX_CHARS));
    // 앞 조각의 끝 100자가 다음 조각의 앞에 다시 나온다.
    expect(chunks[1].startsWith(chunks[0].slice(-100))).toBe(true);
    expect(chunks[chunks.length - 1].endsWith(text.slice(-50))).toBe(true);
  });
});

describe("policyHash / policyEmbeddingText", () => {
  it("changes when the title or the body changes", () => {
    const base = policyHash({ title: "환불", bodyText: "본문" });
    expect(policyHash({ title: "환불", bodyText: "본문" })).toBe(base);
    expect(policyHash({ title: "환불 정책", bodyText: "본문" })).not.toBe(base);
    expect(policyHash({ title: "환불", bodyText: "본문 수정" })).not.toBe(base);
  });

  it("puts the post title in front of the chunk", () => {
    expect(policyEmbeddingText("환불 정책 안내", "고객센터로 문의")).toBe("환불 정책 안내\n\n고객센터로 문의");
  });
});

describe("syncAllPolicies", () => {
  beforeEach(() => {
    vi.mocked(loungeModule.fetchBoardPostsOf).mockReset();
    vi.mocked(embeddingsModule.embedTexts).mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockEmbeddings();
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads the board of the policy post and stores every post's chunks", async () => {
    vi.mocked(loungeModule.fetchBoardPostsOf).mockResolvedValue([refund, terms]);
    const { client, db } = fakeSupabase({ game_pages: [{ game_id: GAME, policy_url: POLICY_URL }] });

    const results = await syncAllPolicies(client);

    expect(loungeModule.fetchBoardPostsOf).toHaveBeenCalledWith("Tree_World", 8347086);
    expect(results).toEqual([{ gameId: GAME, posts: 2, embedded: 2, removed: 0 }]);
    expect(embeddingsModule.embedTexts).toHaveBeenCalledWith([policyEmbeddingText(refund.title, chunkPolicyText(refund.bodyText)[0])]);
    expect(db.policy_chunks).toHaveLength(2);
    expect(db.policy_chunks[0]).toMatchObject({
      game_id: GAME,
      feed_id: refund.feedId,
      chunk_index: 0,
      title: refund.title,
      url: refund.url,
      content_hash: policyHash(refund),
      embedding_model: "text-embedding-3-small",
    });
  });

  it("skips posts whose hash and model are unchanged", async () => {
    vi.mocked(loungeModule.fetchBoardPostsOf).mockResolvedValue([refund]);
    const { client } = fakeSupabase({
      game_pages: [{ game_id: GAME, policy_url: POLICY_URL }],
      policy_chunks: [{ game_id: GAME, feed_id: refund.feedId, chunk_index: 0, content_hash: policyHash(refund), embedding_model: "text-embedding-3-small" }],
    });

    const results = await syncAllPolicies(client);

    expect(embeddingsModule.embedTexts).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ embedded: 0 });
  });

  it("re-embeds a changed post and drops chunks past its new length", async () => {
    const edited = post(refund.feedId, refund.title, "짧아진 본문");
    vi.mocked(loungeModule.fetchBoardPostsOf).mockResolvedValue([edited]);
    const { client, db } = fakeSupabase({
      game_pages: [{ game_id: GAME, policy_url: POLICY_URL }],
      policy_chunks: [0, 1, 2].map((index) => ({ game_id: GAME, feed_id: refund.feedId, chunk_index: index, content: `옛 조각 ${index}`, content_hash: "old", embedding_model: "text-embedding-3-small" })),
    });

    await syncAllPolicies(client);

    expect(db.policy_chunks).toHaveLength(1);
    expect(db.policy_chunks[0]).toMatchObject({ chunk_index: 0, content: "짧아진 본문", content_hash: policyHash(edited) });
  });

  it("re-embeds when the stored vectors came from another model", async () => {
    vi.mocked(loungeModule.fetchBoardPostsOf).mockResolvedValue([refund]);
    const { client } = fakeSupabase({
      game_pages: [{ game_id: GAME, policy_url: POLICY_URL }],
      policy_chunks: [{ game_id: GAME, feed_id: refund.feedId, chunk_index: 0, content_hash: policyHash(refund), embedding_model: "old-model" }],
    });

    await syncAllPolicies(client);

    expect(embeddingsModule.embedTexts).toHaveBeenCalledTimes(1);
  });

  it("deletes chunks of posts that left the board", async () => {
    vi.mocked(loungeModule.fetchBoardPostsOf).mockResolvedValue([refund]);
    const { client, db } = fakeSupabase({
      game_pages: [{ game_id: GAME, policy_url: POLICY_URL }],
      policy_chunks: [
        { game_id: GAME, feed_id: refund.feedId, chunk_index: 0, content_hash: policyHash(refund), embedding_model: "text-embedding-3-small" },
        { game_id: GAME, feed_id: 1, chunk_index: 0, content_hash: "x", embedding_model: "text-embedding-3-small" },
      ],
    });

    const results = await syncAllPolicies(client);

    expect(results[0]).toMatchObject({ removed: 1 });
    expect(db.policy_chunks.map((row) => row.feed_id)).toEqual([refund.feedId]);
  });

  it("keeps stored chunks when the lounge cannot be read", async () => {
    vi.mocked(loungeModule.fetchBoardPostsOf).mockRejectedValue(new Error("naver lounge request failed: 500"));
    const stored = { game_id: GAME, feed_id: refund.feedId, chunk_index: 0, content_hash: "x", embedding_model: "text-embedding-3-small" };
    const { client, db } = fakeSupabase({ game_pages: [{ game_id: GAME, policy_url: POLICY_URL }], policy_chunks: [stored] });

    const results = await syncAllPolicies(client);

    expect(results).toEqual([{ gameId: GAME, posts: 0, embedded: 0, removed: 0, error: "fetch_failed" }]);
    expect(db.policy_chunks).toEqual([stored]);
  });

  it("removes chunks of games whose policy url is gone or not a lounge post", async () => {
    vi.mocked(loungeModule.fetchBoardPostsOf).mockResolvedValue([]);
    const { client, db } = fakeSupabase({
      game_pages: [{ game_id: "game-2", policy_url: "https://example.com/policy" }],
      policy_chunks: [
        { game_id: GAME, feed_id: 1, chunk_index: 0 },
        { game_id: "game-2", feed_id: 2, chunk_index: 0 },
      ],
    });

    const results = await syncAllPolicies(client);

    expect(results).toEqual([]);
    expect(loungeModule.fetchBoardPostsOf).not.toHaveBeenCalled();
    expect(db.policy_chunks).toEqual([]);
  });

  it("keeps going with other posts when one embedding call fails", async () => {
    vi.mocked(loungeModule.fetchBoardPostsOf).mockResolvedValue([refund, terms]);
    vi.mocked(embeddingsModule.embedTexts)
      .mockRejectedValueOnce(new embeddingsModule.EmbeddingError("failed"))
      .mockImplementation(async (texts) => texts.map(() => new Array(1536).fill(0)));
    const { client, db } = fakeSupabase({ game_pages: [{ game_id: GAME, policy_url: POLICY_URL }] });

    const results = await syncAllPolicies(client);

    expect(results[0]).toMatchObject({ embedded: 1, error: "embed_failed" });
    expect(db.policy_chunks.map((row) => row.feed_id)).toEqual([terms.feedId]);
  });

  it("stops embedding when the time budget runs out and reports incomplete", async () => {
    vi.mocked(loungeModule.fetchBoardPostsOf).mockResolvedValue([refund, terms]);
    const { client } = fakeSupabase({ game_pages: [{ game_id: GAME, policy_url: POLICY_URL }] });
    let now = 0;
    vi.mocked(embeddingsModule.embedTexts).mockImplementation(async (texts) => {
      now += 45_000;
      return texts.map(() => new Array(1536).fill(0));
    });

    const results = await syncAllPolicies(client, { clock: () => now });

    expect(results[0]).toMatchObject({ embedded: 1, error: "incomplete" });
  });

  it("returns nothing when the game list cannot be read", async () => {
    const { client } = fakeSupabase({}, "game_pages");
    await expect(syncAllPolicies(client)).resolves.toEqual([]);
  });
});

describe("searchPolicyChunks", () => {
  it("calls match_policy_chunks for the game and maps the rows", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ feed_id: "8347098", chunk_index: 2, title: "환불 정책 안내", content: "고객센터로 문의", url: "u", similarity: 0.61 }],
      error: null,
    });

    const chunks = await searchPolicyChunks({ rpc } as never, GAME, [0.1, 0.2]);

    expect(rpc).toHaveBeenCalledWith("match_policy_chunks", { p_game_id: GAME, p_query: [0.1, 0.2], p_limit: 5 });
    expect(chunks).toEqual([{ feedId: 8347098, chunkIndex: 2, title: "환불 정책 안내", content: "고객센터로 문의", url: "u", similarity: 0.61 }]);
  });

  it("returns an empty list when the rpc fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    await expect(searchPolicyChunks({ rpc } as never, GAME, [0.1])).resolves.toEqual([]);
    vi.restoreAllMocks();
  });
});
