import { describe, it, expect, vi, beforeEach } from "vitest";

const { fetchLoungePosts, fetchLoungeComments } = vi.hoisted(() => ({ fetchLoungePosts: vi.fn(), fetchLoungeComments: vi.fn() }));
vi.mock("@/lib/naver-lounge", () => ({ fetchLoungePosts, fetchLoungeComments }));

import { syncAllLounges } from "@/lib/lounge-sync";

const NOW = new Date("2026-09-21T10:00:00.000Z");
const LATER = new Date("2026-09-21T10:05:00.000Z"); // 다음 실행
const BEFORE = "2026-09-21T09:50:00.000Z"; // 이전 동기화 시각
const OLD = "2026-09-21T09:00:00.000Z";
const FRESH = "2026-09-21T09:57:00.000Z";
const JUST_BEFORE_BASELINE = "2026-09-21T09:49:00.000Z"; // 기준 1분 전(2분 여유 안)
const JUST_BEFORE_NOW = "2026-09-21T09:59:00.000Z"; // 지금 1분 전

interface GameSeed { id: string; name: string; naver_lounge_id: string; lounge_synced_at: string | null }
type Row = Record<string, unknown>;

interface FailGamesUpdate {
  gameId: string;
  /** "error": Supabase 스타일로 {error}를 돌려준다. "throw": 호출 자체가 예상 못 하게 실패한다. */
  mode: "error" | "throw";
}

function fakeSupabase(games: GameSeed[], seedItems: Row[] = [], options: { failGamesUpdate?: FailGamesUpdate } = {}) {
  const items: Row[] = seedItems.map((row, i) => ({ id: `seed-${i}`, ...row }));
  const gameUpdates: Array<{ id: string; patch: Row }> = [];
  const client = {
    items,
    gameUpdates,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let op: "select" | "upsert" | "update" = "select";
      let payload: Row[] | Row = [];
      let orderBy: string | null = null;
      const builder = {
        select: () => builder,
        not: () => builder,
        order: (col: string) => ((orderBy = col), builder),
        eq: (col: string, value: unknown) => (filters.push([col, value]), builder),
        in: (col: string, values: unknown[]) => (filters.push([col, values]), builder),
        upsert: (rows: Row[]) => ((op = "upsert"), (payload = rows), builder),
        update: (patch: Row) => ((op = "update"), (payload = patch), builder),
        then(resolve: (value: { data: unknown; error: unknown }) => void) {
          const fail = options.failGamesUpdate;
          if (table === "games" && op === "update" && fail && filters[0]?.[1] === fail.gameId) {
            if (fail.mode === "throw") throw new Error("games update boom");
            resolve({ data: null, error: { message: "games update failed" } });
            return;
          }
          resolve({ data: run(), error: null });
        },
      };
      const matches = (row: Row) => filters.every(([col, value]) => (Array.isArray(value) ? value.includes(row[col]) : row[col] === value));
      function run(): unknown {
        if (table === "games") {
          if (op === "update") {
            const id = filters[0][1] as string;
            gameUpdates.push({ id, patch: payload as Row });
            // 실제 DB처럼 seed에도 반영한다 — 두 번 실행하는 테스트가 갱신된 기준 시각을 보게.
            Object.assign(games.find((g) => g.id === id) ?? {}, payload as Row);
          }
          if (op === "select" && orderBy) {
            // ascending, nulls first
            const key = orderBy as keyof GameSeed;
            const rank = (g: GameSeed) => (g[key] == null ? "" : String(g[key]));
            return [...games].sort((a, b) => rank(a).localeCompare(rank(b)));
          }
          return games;
        }
        if (op === "upsert") {
          const inserted: Row[] = [];
          for (const row of payload as Row[]) {
            if (items.some((it) => it.game_id === row.game_id && it.kind === row.kind && it.naver_id === row.naver_id)) continue;
            const withId = { id: `new-${items.length}`, ...row };
            items.push(withId);
            inserted.push(withId);
          }
          return inserted;
        }
        if (op === "update") {
          items.filter(matches).forEach((row) => Object.assign(row, payload));
          return null;
        }
        return items.filter(matches);
      }
      return builder;
    },
  };
  return client;
}

const game = (over: Partial<GameSeed> = {}): GameSeed => ({ id: "g1", name: "갓생 토크", naver_lounge_id: "L1", lounge_synced_at: BEFORE, ...over });
const post = (over: Record<string, unknown> = {}) => ({
  feedId: 100, title: "질문 있어요", bodyText: "본문", boardName: "자유", nickname: "유저1", isUser: true, postedAt: FRESH,
  url: "https://game.naver.com/lounge/L1/board/detail/100", commentCount: 0, ...over,
});
const comment = (over: Record<string, unknown> = {}) => ({ commentId: 500, feedId: 100, bodyText: "댓글", nickname: "유저2", isUser: true, postedAt: FRESH, ...over });
const seedPost = (over: Row = {}): Row => ({ game_id: "g1", kind: "post", naver_id: 100, feed_id: 100, title: "질문 있어요", url: "u", is_user: true, comment_count: 0, read_at: OLD, posted_at: OLD, ...over });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchLoungePosts.mockReset();
  fetchLoungeComments.mockReset().mockResolvedValue([]);
});

describe("syncAllLounges", () => {
  it("stores a new user post as unread and reports it as added", async () => {
    fetchLoungePosts.mockResolvedValue([post()]);
    const supabase = fakeSupabase([game()]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(result).toMatchObject({ gameId: "g1", gameName: "갓생 토크", fetched: 1 });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({ kind: "post", naverId: 100, title: "질문 있어요", readAt: null });
    expect(supabase.items[0]).toMatchObject({ read_at: null, comment_count: 0, is_user: true });
    expect(supabase.gameUpdates).toEqual([{ id: "g1", patch: { lounge_synced_at: NOW.toISOString() } }]);
    expect(fetchLoungeComments).not.toHaveBeenCalled();
  });

  it("marks everything read on the first run so connecting a lounge does not flood", async () => {
    // 방금 올라온 글(1분 전)도 첫 실행에는 읽음이어야 한다 — 2분 여유는 첫 실행에 적용하지 않는다.
    fetchLoungePosts.mockResolvedValue([post({ commentCount: 1 }), post({ feedId: 101, postedAt: JUST_BEFORE_NOW })]);
    fetchLoungeComments.mockResolvedValue([comment()]);
    const supabase = fakeSupabase([game({ lounge_synced_at: null })]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(result.added).toEqual([]);
    expect(supabase.items).toHaveLength(3);
    expect(supabase.items.every((row) => row.read_at === NOW.toISOString())).toBe(true);
  });

  it("treats an item posted just before the baseline as unread — naver 시각이 우리보다 늦을 수 있다", async () => {
    fetchLoungePosts.mockResolvedValue([post({ postedAt: JUST_BEFORE_BASELINE })]);
    const supabase = fakeSupabase([game()]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(result.added).toHaveLength(1);
    expect(supabase.items[0].read_at).toBeNull();
  });

  it("stores GM posts as read and never reports them", async () => {
    fetchLoungePosts.mockResolvedValue([post({ isUser: false })]);
    const supabase = fakeSupabase([game()]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(result.added).toEqual([]);
    expect(supabase.items[0].read_at).toBe(NOW.toISOString());
  });

  it("reads comments only for posts whose comment count changed, and titles them after the post", async () => {
    fetchLoungePosts.mockResolvedValue([post({ commentCount: 2, postedAt: OLD }), post({ feedId: 101, commentCount: 3, postedAt: OLD })]);
    fetchLoungeComments.mockResolvedValue([comment(), comment({ commentId: 501, isUser: false }), comment({ commentId: 502, postedAt: OLD })]);
    const supabase = fakeSupabase([game()], [seedPost({ comment_count: 1 }), seedPost({ naver_id: 101, feed_id: 101, comment_count: 3 })]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(fetchLoungeComments).toHaveBeenCalledTimes(1);
    expect(fetchLoungeComments).toHaveBeenCalledWith("L1", 100);
    // 유저 댓글이면서 이전 동기화 뒤에 쓴 500번만 알림. GM(501)과 옛 댓글(502)은 읽음.
    expect(result.added.map((item) => item.naverId)).toEqual([500]);
    expect(result.added[0]).toMatchObject({ kind: "comment", feedId: 100, title: "질문 있어요", url: "https://game.naver.com/lounge/L1/board/detail/100" });
    expect(supabase.items.find((row) => row.kind === "post" && row.naver_id === 100)?.comment_count).toBe(2);
  });

  it("keeps the stored comment count when reading comments fails so the next run retries", async () => {
    fetchLoungePosts.mockResolvedValue([post({ commentCount: 2, postedAt: OLD })]);
    fetchLoungeComments.mockRejectedValue(new Error("boom"));
    const supabase = fakeSupabase([game()], [seedPost({ comment_count: 1 })]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(result.error).toBeUndefined();
    expect(supabase.items[0].comment_count).toBe(1);
  });

  it("keeps the watermark when a comment fetch failed, so the next run still alerts on that comment", async () => {
    fetchLoungePosts.mockResolvedValue([post({ commentCount: 2, postedAt: OLD })]);
    fetchLoungeComments.mockRejectedValueOnce(new Error("boom"));
    const supabase = fakeSupabase([game()], [seedPost({ comment_count: 1 })]);
    await syncAllLounges(supabase as never, { now: NOW });
    expect(supabase.gameUpdates).toEqual([]);

    // 다음 실행: 기준 시각이 그대로라 09:57 댓글이 여전히 "이전 동기화 뒤"다.
    fetchLoungeComments.mockResolvedValueOnce([comment()]);
    const [second] = await syncAllLounges(supabase as never, { now: LATER });
    expect(second.added.map((item) => item.naverId)).toEqual([500]);
    expect(supabase.items.find((row) => row.kind === "comment")?.read_at).toBeNull();
    expect(supabase.gameUpdates).toEqual([{ id: "g1", patch: { lounge_synced_at: LATER.toISOString() } }]);
  });

  it("keeps the watermark when more posts changed than the per-run comment cap", async () => {
    fetchLoungePosts.mockResolvedValue(Array.from({ length: 25 }, (_, i) => post({ feedId: 200 + i, commentCount: 1 })));
    const supabase = fakeSupabase([game()]);
    await syncAllLounges(supabase as never, { now: NOW });
    expect(fetchLoungeComments).toHaveBeenCalledTimes(20);
    expect(supabase.gameUpdates).toEqual([]);
  });

  it("advances the watermark on the first run even when the run was incomplete", async () => {
    fetchLoungePosts.mockResolvedValue([post({ commentCount: 1 })]);
    fetchLoungeComments.mockRejectedValueOnce(new Error("boom"));
    const supabase = fakeSupabase([game({ lounge_synced_at: null })]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(result.added).toEqual([]);
    expect(supabase.gameUpdates).toEqual([{ id: "g1", patch: { lounge_synced_at: NOW.toISOString() } }]);
  });

  it("reports fetch_failed without advancing the watermark, and still syncs the other games", async () => {
    fetchLoungePosts.mockRejectedValueOnce(new Error("naver down")).mockResolvedValueOnce([post()]);
    const supabase = fakeSupabase([game(), game({ id: "g2", name: "둘째", naver_lounge_id: "L2" })]);
    const results = await syncAllLounges(supabase as never, { now: NOW });
    expect(results[0]).toMatchObject({ gameId: "g1", error: "fetch_failed", added: [] });
    expect(results[1].added).toHaveLength(1);
    expect(supabase.gameUpdates.map((u) => u.id)).toEqual(["g2"]);
  });

  it("reads comments for at most 20 posts per run", async () => {
    fetchLoungePosts.mockResolvedValue(Array.from({ length: 25 }, (_, i) => post({ feedId: 200 + i, commentCount: 1 })));
    const supabase = fakeSupabase([game()]);
    await syncAllLounges(supabase as never, { now: NOW });
    expect(fetchLoungeComments).toHaveBeenCalledTimes(20);
  });

  it("warns and still returns the found items when the watermark update fails", async () => {
    fetchLoungePosts.mockResolvedValue([post()]);
    const supabase = fakeSupabase([game()], [], { failGamesUpdate: { gameId: "g1", mode: "error" } });
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(result.error).toBeUndefined();
    expect(result.added).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith("[lounge-sync] 동기화 시각 갱신 실패", expect.objectContaining({ gameId: "g1" }));
    expect(supabase.gameUpdates).toEqual([]);
  });

  it("stops starting comment fetches when the time budget runs out and keeps the watermark", async () => {
    fetchLoungePosts.mockResolvedValue([200, 201, 202].map((feedId) => post({ feedId, commentCount: 1 })));
    let elapsed = 0;
    fetchLoungeComments.mockReset().mockImplementation(async () => ((elapsed += 25_000), []));
    const supabase = fakeSupabase([game()]);
    await syncAllLounges(supabase as never, { now: NOW, clock: () => elapsed });
    // 40초 예산: 0초·25초에 두 번 부르고 50초에는 시작하지 않는다.
    expect(fetchLoungeComments).toHaveBeenCalledTimes(2);
    expect(supabase.gameUpdates).toEqual([]);
  });

  it("does not start another game when the budget is gone, and keeps the finished game's watermark", async () => {
    let elapsed = 0;
    fetchLoungePosts.mockImplementation(async () => ((elapsed += 45_000), [post()]));
    const supabase = fakeSupabase([game(), game({ id: "g2", name: "둘째", naver_lounge_id: "L2" })]);
    const results = await syncAllLounges(supabase as never, { now: NOW, clock: () => elapsed });
    expect(results.map((r) => r.gameId)).toEqual(["g1"]);
    expect(fetchLoungePosts).toHaveBeenCalledTimes(1);
    expect(supabase.gameUpdates).toEqual([{ id: "g1", patch: { lounge_synced_at: NOW.toISOString() } }]);
  });

  it("starts with the least recently synced game, so a game skipped for time goes first next run", async () => {
    let elapsed = 0;
    fetchLoungePosts.mockImplementation(async () => ((elapsed += 45_000), [post()]));
    const supabase = fakeSupabase([game(), game({ id: "g2", name: "둘째", naver_lounge_id: "L2" })]);
    await syncAllLounges(supabase as never, { now: NOW, clock: () => elapsed });
    // g1만 기준 시각이 앞으로 갔으니 다음 실행은 밀렸던 g2부터 읽는다.
    elapsed = 0;
    const results = await syncAllLounges(supabase as never, { now: LATER, clock: () => elapsed });
    expect(results.map((r) => r.gameId)).toEqual(["g2"]);
  });

  it("hands each game's result to onGameSynced as soon as that game finishes", async () => {
    fetchLoungePosts.mockResolvedValue([post()]);
    const supabase = fakeSupabase([game(), game({ id: "g2", name: "둘째", naver_lounge_id: "L2" })]);
    const seen: Array<{ gameId: string; fetches: number }> = [];
    const onGameSynced = vi.fn((result: { gameId: string }) => {
      seen.push({ gameId: result.gameId, fetches: fetchLoungePosts.mock.calls.length });
    });
    await syncAllLounges(supabase as never, { now: NOW, onGameSynced });
    // 두 번째 게임을 읽기 전에 첫 게임 알림이 나간다.
    expect(seen).toEqual([{ gameId: "g1", fetches: 1 }, { gameId: "g2", fetches: 2 }]);
  });

  it("keeps syncing when onGameSynced throws", async () => {
    fetchLoungePosts.mockResolvedValue([post()]);
    const supabase = fakeSupabase([game(), game({ id: "g2", name: "둘째", naver_lounge_id: "L2" })]);
    const results = await syncAllLounges(supabase as never, {
      now: NOW,
      onGameSynced: () => {
        throw new Error("slack down");
      },
    });
    expect(results.map((r) => r.gameId)).toEqual(["g1", "g2"]);
    expect(console.warn).toHaveBeenCalledWith("[lounge-sync] 게임별 알림 처리 실패", expect.objectContaining({ gameId: "g1" }));
  });

  it("reports fetch_failed for a game whose sync rejects unexpectedly, and still syncs the next game", async () => {
    fetchLoungePosts.mockResolvedValue([post()]);
    const supabase = fakeSupabase([game(), game({ id: "g2", name: "둘째", naver_lounge_id: "L2" })], [], {
      failGamesUpdate: { gameId: "g1", mode: "throw" },
    });
    const results = await syncAllLounges(supabase as never, { now: NOW });
    expect(results[0]).toMatchObject({ gameId: "g1", gameName: "갓생 토크", fetched: 0, added: [], error: "fetch_failed" });
    expect(results[1].error).toBeUndefined();
    expect(results[1].added).toHaveLength(1);
    expect(supabase.gameUpdates.map((u) => u.id)).toEqual(["g2"]);
  });
});
