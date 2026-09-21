import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLoungeComments, fetchLoungePosts, type LoungeComment, type LoungePost } from "@/lib/naver-lounge";
import { mapLoungeItem, type LoungeItemRow } from "@/lib/lounge-items";

/**
 * 네이버 라운지 동기화. pg_cron이 5분마다 /api/lounge/sync를 부르면 라운지가 연결된 게임마다
 * 최신 글을 읽어 처음 보는 글을 넣고, 댓글 수가 달라진 글만 댓글을 읽는다.
 *
 * 알림(read_at = null)이 되는 것은 "유저가 쓴 항목"이면서 "이전 동기화 뒤에 쓴 항목"뿐이다.
 * 첫 실행은 이전 동기화가 없어 기준을 지금으로 잡으므로 기존 글·댓글이 전부 읽음으로 들어간다.
 */

/** 한 번 실행에 댓글을 읽는 글 수. 서버리스 함수 시간 안에 끝나야 한다. 남은 글은 다음 실행이 본다. */
const COMMENT_FETCH_LIMIT = 20;
const BODY_LIMIT = 1000;
const ON_CONFLICT = "game_id,kind,naver_id";

export interface LoungeSyncResult {
  gameId: string;
  gameName: string;
  fetched: number;
  /** 이번에 새로 들어간 안 읽은 유저 항목. Slack 알림이 이걸 쓴다. */
  added: LoungeItemRow[];
  error?: "fetch_failed";
}

interface SyncOptions {
  now?: Date;
}

interface LoungeGame {
  id: string;
  name: string;
  naver_lounge_id: string;
  lounge_synced_at: string | null;
}

function readAtFor(isUser: boolean, postedAt: string, baseline: number, nowIso: string): string | null {
  return isUser && new Date(postedAt).getTime() > baseline ? null : nowIso;
}

function postRow(game: LoungeGame, post: LoungePost, baseline: number, nowIso: string) {
  return {
    game_id: game.id,
    kind: "post",
    naver_id: post.feedId,
    feed_id: post.feedId,
    title: post.title,
    body: post.bodyText.slice(0, BODY_LIMIT),
    board_name: post.boardName,
    nickname: post.nickname,
    is_user: post.isUser,
    url: post.url,
    // 0으로 넣어 두면 댓글이 있는 새 글은 바로 아래에서 댓글을 한 번 읽는다.
    comment_count: 0,
    posted_at: post.postedAt,
    read_at: readAtFor(post.isUser, post.postedAt, baseline, nowIso),
  };
}

function commentRow(game: LoungeGame, post: LoungePost, comment: LoungeComment, baseline: number, nowIso: string) {
  return {
    game_id: game.id,
    kind: "comment",
    naver_id: comment.commentId,
    feed_id: post.feedId,
    title: post.title,
    body: comment.bodyText.slice(0, BODY_LIMIT),
    board_name: post.boardName,
    nickname: comment.nickname,
    is_user: comment.isUser,
    url: post.url,
    comment_count: null,
    posted_at: comment.postedAt,
    read_at: readAtFor(comment.isUser, comment.postedAt, baseline, nowIso),
  };
}

/** 처음 보는 행만 넣고, 그중 안 읽음으로 들어간 것을 돌려준다. 중복은 유니크 인덱스가 거른다. */
async function insertNew(supabase: SupabaseClient, rows: Array<Record<string, unknown>>): Promise<LoungeItemRow[]> {
  if (rows.length === 0) return [];
  const { data, error } = await supabase.from("lounge_items").upsert(rows, { onConflict: ON_CONFLICT, ignoreDuplicates: true }).select("*");
  if (error) throw new Error(`lounge_items insert failed: ${error.message}`);
  return (data ?? []).map(mapLoungeItem).filter((item) => item.readAt === null);
}

async function syncLounge(supabase: SupabaseClient, game: LoungeGame, now: Date): Promise<LoungeSyncResult> {
  const result: LoungeSyncResult = { gameId: game.id, gameName: game.name, fetched: 0, added: [] };
  const nowIso = now.toISOString();
  const baseline = game.lounge_synced_at ? new Date(game.lounge_synced_at).getTime() : now.getTime();

  let posts: LoungePost[];
  const knownCounts = new Map<number, number>();
  try {
    posts = await fetchLoungePosts(game.naver_lounge_id);
    result.fetched = posts.length;
    if (posts.length > 0) {
      const { data, error } = await supabase
        .from("lounge_items")
        .select("feed_id, comment_count")
        .eq("game_id", game.id)
        .eq("kind", "post")
        .in("feed_id", posts.map((post) => post.feedId));
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Array<{ feed_id: number; comment_count: number | null }>) {
        knownCounts.set(Number(row.feed_id), row.comment_count ?? 0);
      }
    }
    const newPosts = posts.filter((post) => !knownCounts.has(post.feedId));
    result.added.push(...(await insertNew(supabase, newPosts.map((post) => postRow(game, post, baseline, nowIso)))));
  } catch (err) {
    // 확인 시각을 갱신하지 않아 다음 실행이 같은 기준으로 다시 본다.
    console.warn("[lounge-sync] 글 목록 실패", { gameId: game.id, err });
    return { ...result, added: [], error: "fetch_failed" };
  }

  const changed = posts.filter((post) => post.commentCount !== (knownCounts.get(post.feedId) ?? 0)).slice(0, COMMENT_FETCH_LIMIT);
  for (const post of changed) {
    try {
      const comments = await fetchLoungeComments(game.naver_lounge_id, post.feedId);
      result.added.push(...(await insertNew(supabase, comments.map((comment) => commentRow(game, post, comment, baseline, nowIso)))));
      await supabase.from("lounge_items").update({ comment_count: post.commentCount }).eq("game_id", game.id).eq("kind", "post").eq("naver_id", post.feedId);
    } catch (err) {
      // comment_count를 그대로 둬 다음 실행이 이 글의 댓글을 다시 읽는다.
      console.warn("[lounge-sync] 댓글 실패", { gameId: game.id, feedId: post.feedId, err });
    }
  }

  await supabase.from("games").update({ lounge_synced_at: nowIso }).eq("id", game.id);
  return result;
}

/** 라운지가 연결된 게임을 차례로 동기화한다. 던지지 않는다 — 게임 하나의 실패가 나머지를 막지 않는다. */
export async function syncAllLounges(supabase: SupabaseClient, options: SyncOptions = {}): Promise<LoungeSyncResult[]> {
  const now = options.now ?? new Date();
  const { data, error } = await supabase.from("games").select("id, name, naver_lounge_id, lounge_synced_at").not("naver_lounge_id", "is", null);
  if (error || !data) {
    console.warn("[lounge-sync] 게임 목록 실패", error);
    return [];
  }
  const results: LoungeSyncResult[] = [];
  for (const game of data as LoungeGame[]) {
    results.push(await syncLounge(supabase, game, now));
  }
  return results;
}
