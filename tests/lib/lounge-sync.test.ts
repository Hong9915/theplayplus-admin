import { describe, it, expect, vi, beforeEach } from "vitest";

const { fetchLoungePosts, fetchLoungeComments } = vi.hoisted(() => ({ fetchLoungePosts: vi.fn(), fetchLoungeComments: vi.fn() }));
vi.mock("@/lib/naver-lounge", () => ({ fetchLoungePosts, fetchLoungeComments }));

import { syncAllLounges } from "@/lib/lounge-sync";

const NOW = new Date("2026-09-21T10:00:00.000Z");
const BEFORE = "2026-09-21T09:50:00.000Z"; // 이전 동기화 시각
const OLD = "2026-09-21T09:00:00.000Z";
const FRESH = "2026-09-21T09:57:00.000Z";

interface GameSeed { id: string; name: string; naver_lounge_id: string; lounge_synced_at: string | null }
type Row = Record<string, unknown>;

function fakeSupabase(games: GameSeed[], seedItems: Row[] = []) {
  const items: Row[] = seedItems.map((row, i) => ({ id: `seed-${i}`, ...row }));
  const gameUpdates: Array<{ id: string; patch: Row }> = [];
  const client = {
    items,
    gameUpdates,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let op: "select" | "upsert" | "update" = "select";
      let payload: Row[] | Row = [];
      const builder = {
        select: () => builder,
        not: () => builder,
        eq: (col: string, value: unknown) => (filters.push([col, value]), builder),
        in: (col: string, values: unknown[]) => (filters.push([col, values]), builder),
        upsert: (rows: Row[]) => ((op = "upsert"), (payload = rows), builder),
        update: (patch: Row) => ((op = "update"), (payload = patch), builder),
        then(resolve: (value: { data: unknown; error: null }) => void) {
          resolve({ data: run(), error: null });
        },
      };
      const matches = (row: Row) => filters.every(([col, value]) => (Array.isArray(value) ? value.includes(row[col]) : row[col] === value));
      function run(): unknown {
        if (table === "games") {
          if (op === "update") gameUpdates.push({ id: filters[0][1] as string, patch: payload as Row });
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
    fetchLoungePosts.mockResolvedValue([post({ commentCount: 1 })]);
    fetchLoungeComments.mockResolvedValue([comment()]);
    const supabase = fakeSupabase([game({ lounge_synced_at: null })]);
    const [result] = await syncAllLounges(supabase as never, { now: NOW });
    expect(result.added).toEqual([]);
    expect(supabase.items).toHaveLength(2);
    expect(supabase.items.every((row) => row.read_at === NOW.toISOString())).toBe(true);
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
});
