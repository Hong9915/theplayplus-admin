import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLoungeComments, fetchLoungePosts, type LoungeComment, type LoungePost } from "@/lib/naver-lounge";
import { mapLoungeItem, type LoungeItemRow } from "@/lib/lounge-items";

/**
 * 네이버 라운지 동기화. pg_cron이 5분마다 /api/lounge/sync를 부르면 라운지가 연결된 게임마다
 * 최신 글을 읽어 처음 보는 글을 넣고, 댓글 수가 달라진 글만 댓글을 읽는다.
 *
 * 알림(read_at = null)이 되는 것은 "유저가 쓴 항목"이면서 "이전 동기화 뒤에 쓴 항목"뿐이다.
 * 첫 실행은 이전 동기화가 없어 기준을 지금으로 잡으므로 기존 글·댓글이 전부 읽음으로 들어간다.
 *
 * 기준 시각(`games.lounge_synced_at`)은 이번 실행이 볼 것을 다 봤을 때만 앞으로 옮긴다. 댓글 읽기가
 * 실패했거나 상한·시간 때문에 남은 글이 있으면 그대로 둬, 다음 실행이 같은 기준으로 다시 보고
 * 놓친 항목을 안 읽음으로 넣는다. 이미 넣은 항목은 유니크 인덱스가 걸러 중복이 생기지 않는다.
 */

/** 한 번 실행에 댓글을 읽는 글 수. 서버리스 함수 시간 안에 끝나야 한다. 남은 글은 다음 실행이 본다. */
const COMMENT_FETCH_LIMIT = 20;
/**
 * 안 읽음 판정에 두는 여유. 네이버 `createdDate`는 초 단위로 끊기고 글이 API에 늦게 나타날 수 있어,
 * 기준 시각보다 조금 앞선 항목도 처음 보는 것이면 알림으로 친다. 이미 본 항목은 유니크 인덱스가 거르므로
 * 여유를 둬도 중복 알림은 생기지 않는다. 첫 실행에는 적용하지 않는다(기존 글이 알림으로 쏟아지지 않게).
 */
const UNREAD_MARGIN_MS = 2 * 60_000;
/** 한 번 호출에 쓰는 시간 상한. 라우트의 maxDuration(60초)보다 넉넉히 짧게 잡는다. */
const BUDGET_MS = 40_000;
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
  /** 경과 시간을 재는 시계(ms). 테스트에서 갈아 끼운다. */
  clock?: () => number;
  /** 게임 하나가 끝날 때마다 부른다(Slack 알림). 던져도 경고만 남기고 나머지 게임은 계속한다. */
  onGameSynced?: (result: LoungeSyncResult) => void | Promise<void>;
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

async function syncLounge(supabase: SupabaseClient, game: LoungeGame, now: Date, outOfTime: () => boolean): Promise<LoungeSyncResult> {
  const result: LoungeSyncResult = { gameId: game.id, gameName: game.name, fetched: 0, added: [] };
  const nowIso = now.toISOString();
  const firstRun = !game.lounge_synced_at;
  // 첫 실행은 여유 없이 지금을 기준으로 잡아 기존 글·댓글이 전부 읽음으로 들어간다.
  const baseline = firstRun ? now.getTime() : new Date(game.lounge_synced_at as string).getTime() - UNREAD_MARGIN_MS;
  /** 이번 실행이 못 본 것이 남았는가. 남았으면 기준 시각을 옮기지 않는다. */
  let incomplete = false;

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

  const allChanged = posts.filter((post) => post.commentCount !== (knownCounts.get(post.feedId) ?? 0));
  const changed = allChanged.slice(0, COMMENT_FETCH_LIMIT);
  // 상한에 걸려 미룬 글이 있으면 이번 실행은 미완이다.
  if (allChanged.length > changed.length) incomplete = true;
  for (const post of changed) {
    if (outOfTime()) {
      console.warn("[lounge-sync] 시간이 모자라 댓글 읽기를 멈춤", { gameId: game.id, feedId: post.feedId });
      incomplete = true;
      break;
    }
    try {
      const comments = await fetchLoungeComments(game.naver_lounge_id, post.feedId);
      result.added.push(...(await insertNew(supabase, comments.map((comment) => commentRow(game, post, comment, baseline, nowIso)))));
      const { error: countError } = await supabase
        .from("lounge_items")
        .update({ comment_count: post.commentCount })
        .eq("game_id", game.id)
        .eq("kind", "post")
        .eq("naver_id", post.feedId);
      if (countError) throw new Error(countError.message);
    } catch (err) {
      // comment_count를 그대로 둬 다음 실행이 이 글의 댓글을 다시 읽는다.
      console.warn("[lounge-sync] 댓글 실패", { gameId: game.id, feedId: post.feedId, err });
      incomplete = true;
    }
  }

  // 미완이면 기준 시각을 그대로 둔다 — 다음 실행이 같은 기준으로 봐야 못 본 항목이 안 읽음으로 들어간다.
  // 첫 실행만은 언제나 옮긴다(기준이 없으면 다음 실행도 기존 글을 전부 읽음으로 넣고 끝나므로 소용없다).
  if (incomplete && !firstRun) {
    return result;
  }

  const { error: watermarkError } = await supabase.from("games").update({ lounge_synced_at: nowIso }).eq("id", game.id);
  if (watermarkError) {
    // 결과는 그대로 돌려준다 — 이번에 찾은 항목은 이미 저장돼 있으니 알림은 나가야 한다.
    // 다음 실행은 갱신되지 않은 이전 시각을 기준으로 다시 훑는다.
    console.warn("[lounge-sync] 동기화 시각 갱신 실패", { gameId: game.id, watermarkError });
  }
  return result;
}

/** 라운지가 연결된 게임을 차례로 동기화한다. 던지지 않는다 — 게임 하나의 실패가 나머지를 막지 않는다. */
export async function syncAllLounges(supabase: SupabaseClient, options: SyncOptions = {}): Promise<LoungeSyncResult[]> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  /** 남은 시간이 없으면 새 댓글 조회·새 게임을 시작하지 않는다. 남은 일은 다음 실행(5분 뒤)이 한다. */
  const outOfTime = () => clock() - startedAt >= BUDGET_MS;

  // 가장 오래전에 확인한 게임부터 — 앞 게임이 시간을 다 써도 밀린 게임이 다음 실행에서 맨 앞으로 온다.
  const { data, error } = await supabase
    .from("games")
    .select("id, name, naver_lounge_id, lounge_synced_at")
    .not("naver_lounge_id", "is", null)
    .order("lounge_synced_at", { ascending: true, nullsFirst: true });
  if (error || !data) {
    console.warn("[lounge-sync] 게임 목록 실패", error);
    return [];
  }
  const results: LoungeSyncResult[] = [];
  for (const game of data as LoungeGame[]) {
    if (outOfTime()) {
      console.warn("[lounge-sync] 시간이 모자라 남은 게임을 다음 실행으로 미룸", { gameId: game.id });
      break;
    }
    let result: LoungeSyncResult;
    try {
      result = await syncLounge(supabase, game, now, outOfTime);
    } catch (err) {
      // syncLounge 내부는 대부분 자체 try/catch로 감싸져 있지만, 예상 못 한 예외가 새어 나와도
      // 이 게임만 실패로 기록하고 나머지 게임은 계속 동기화한다.
      console.warn("[lounge-sync] 게임 동기화 실패", { gameId: game.id, err });
      result = { gameId: game.id, gameName: game.name, fetched: 0, added: [], error: "fetch_failed" };
    }
    results.push(result);
    try {
      // 게임 하나가 끝날 때마다 알린다 — 뒤 게임에서 시간이 다 돼도 앞 게임 알림은 이미 나갔다.
      await options.onGameSynced?.(result);
    } catch (err) {
      console.warn("[lounge-sync] 게임별 알림 처리 실패", { gameId: game.id, err });
    }
  }
  return results;
}
