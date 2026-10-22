import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBoardPostsOf, parseLoungePostUrl, type LoungeBoardPost } from "@/lib/naver-lounge";
import { EMBEDDING_MODEL, EmbeddingError, embedTexts } from "@/lib/embeddings";

/**
 * 운영정책 임베딩. 웹사이트 게임 페이지의 운영정책 주소(`game_pages.policy_url`, 라운지 글)가
 * 속한 게시판의 글(이용약관·환불 정책 등)을 조각으로 나눠 `policy_chunks`에 임베딩해 두고(마이그레이션 0032),
 * AI 답변 추천이 문의와 가까운 조각을 근거로 싣는다.
 *
 * pg_cron이 매시간 /api/policies/sync를 부른다. 글마다 제목+본문 해시를 저장해 두고 같으면 건너뛰므로
 * 글이 바뀌지 않으면 OpenAI를 부르지 않는다. 라운지를 못 읽은 게임은 저장된 조각을 그대로 둔다.
 */

/** 조각 하나의 글자 상한. 조항 몇 개가 들어가고 검색이 한 주제에 맞을 만큼. */
export const POLICY_CHUNK_MAX_CHARS = 800;
/** 상한보다 긴 단락을 자를 때 앞 조각과 겹치는 글자 수. */
const LONG_PARAGRAPH_OVERLAP = 100;
/** 조각 끝 단락이 이보다 짧으면(보통 "[2] 자체 환불" 같은 조항 제목) 다음 조각 앞에도 둔다. */
const CARRY_MAX_CHARS = 200;
/** 한 번 호출에 쓰는 시간 상한. 라우트의 maxDuration(60초)보다 넉넉히 짧게 잡는다. 남은 글은 다음 실행이 본다. */
const BUDGET_MS = 40_000;
const ON_CONFLICT = "game_id,feed_id,chunk_index";

export interface PolicyChunk {
  feedId: number;
  chunkIndex: number;
  title: string;
  content: string;
  url: string;
  similarity: number;
}

export interface PolicySyncResult {
  gameId: string;
  /** 게시판에서 읽은 글 수 */
  posts: number;
  /** 이번에 새로 임베딩한 글 수 */
  embedded: number;
  /** 게시판에서 사라져 지운 글 수 */
  removed: number;
  /** incomplete: 시간이 모자라 남은 글을 다음 실행으로 미룸 */
  error?: "fetch_failed" | "embed_failed" | "store_failed" | "incomplete";
}

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= POLICY_CHUNK_MAX_CHARS) return [paragraph];
  const pieces: string[] = [];
  const step = POLICY_CHUNK_MAX_CHARS - LONG_PARAGRAPH_OVERLAP;
  for (let start = 0; start < paragraph.length; start += step) {
    pieces.push(paragraph.slice(start, start + POLICY_CHUNK_MAX_CHARS));
    if (start + POLICY_CHUNK_MAX_CHARS >= paragraph.length) break;
  }
  return pieces;
}

/** 본문을 단락(줄) 단위로 상한까지 채워 조각으로 나눈다. 단락 하나가 상한보다 길면 겹치게 자른다. */
export function chunkPolicyText(body: string): string[] {
  const pieces = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .flatMap(splitLongParagraph);

  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const piece of pieces) {
    if (current.length > 0 && length + 1 + piece.length > POLICY_CHUNK_MAX_CHARS) {
      chunks.push(current);
      // 조항 제목 바로 뒤에서 끊기면 다음 조각이 어느 조항인지 잃는다.
      const last = current[current.length - 1];
      const carry = last.length <= CARRY_MAX_CHARS && last.length + 1 + piece.length <= POLICY_CHUNK_MAX_CHARS;
      current = carry ? [last] : [];
      length = carry ? last.length : 0;
    }
    length += (current.length > 0 ? 1 : 0) + piece.length;
    current.push(piece);
  }
  if (current.length > 0) chunks.push(current);
  return chunks.map((lines) => lines.join("\n"));
}

/** 제목을 앞에 붙여 임베딩한다. "환불"이 본문에 없는 조각도 "환불 정책 안내" 글이면 환불 문의에 걸린다. */
export function policyEmbeddingText(title: string, chunk: string): string {
  return `${title}\n\n${chunk}`;
}

export function policyHash(post: Pick<LoungeBoardPost, "title" | "bodyText">): string {
  return createHash("sha256").update(`${post.title}\n\n${post.bodyText}`).digest("hex");
}

interface PolicyGame {
  gameId: string;
  loungeId: string;
  feedId: number;
}

/** 글 하나의 조각을 임베딩해 넣고, 글이 짧아져 남은 뒤쪽 조각을 지운다. 지우고 넣지 않아 빈 순간이 없다. */
async function storePost(supabase: SupabaseClient, gameId: string, post: LoungeBoardPost, hash: string): Promise<void> {
  const chunks = chunkPolicyText(post.bodyText);
  const vectors = await embedTexts(chunks.map((chunk) => policyEmbeddingText(post.title, chunk)));
  const updatedAt = new Date().toISOString();
  const rows = chunks.map((content, index) => ({
    game_id: gameId,
    feed_id: post.feedId,
    chunk_index: index,
    title: post.title,
    content,
    url: post.url,
    content_hash: hash,
    embedding: vectors[index],
    embedding_model: EMBEDDING_MODEL,
    posted_at: post.postedAt,
    updated_at: updatedAt,
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from("policy_chunks").upsert(rows, { onConflict: ON_CONFLICT });
    if (error) throw new Error(error.message);
  }
  const { error } = await supabase
    .from("policy_chunks")
    .delete()
    .eq("game_id", gameId)
    .eq("feed_id", post.feedId)
    .gte("chunk_index", rows.length);
  if (error) throw new Error(error.message);
}

async function syncGamePolicies(supabase: SupabaseClient, game: PolicyGame, outOfTime: () => boolean): Promise<PolicySyncResult> {
  const result: PolicySyncResult = { gameId: game.gameId, posts: 0, embedded: 0, removed: 0 };

  let posts: LoungeBoardPost[];
  try {
    posts = await fetchBoardPostsOf(game.loungeId, game.feedId);
  } catch (error) {
    console.warn("[policies] 라운지 게시판 읽기 실패", { gameId: game.gameId, error });
    return { ...result, error: "fetch_failed" };
  }
  result.posts = posts.length;

  const { data, error } = await supabase.from("policy_chunks").select("feed_id, content_hash, embedding_model").eq("game_id", game.gameId);
  if (error || !data) {
    console.warn("[policies] 저장된 조각 읽기 실패", { gameId: game.gameId, error });
    return { ...result, error: "store_failed" };
  }
  const stored = new Map<number, string>();
  for (const row of data as Array<{ feed_id: number | string; content_hash: string; embedding_model: string }>) {
    stored.set(Number(row.feed_id), `${row.content_hash}:${row.embedding_model}`);
  }

  const live = new Set(posts.map((post) => post.feedId));
  const gone = Array.from(stored.keys()).filter((feedId) => !live.has(feedId));
  if (gone.length > 0) {
    const { error: deleteError } = await supabase.from("policy_chunks").delete().eq("game_id", game.gameId).in("feed_id", gone);
    if (deleteError) {
      console.warn("[policies] 사라진 글 지우기 실패", { gameId: game.gameId, deleteError });
      result.error = "store_failed";
    } else {
      result.removed = gone.length;
    }
  }

  for (const post of posts) {
    const hash = policyHash(post);
    if (stored.get(post.feedId) === `${hash}:${EMBEDDING_MODEL}`) continue;
    if (outOfTime()) {
      result.error = "incomplete";
      break;
    }
    try {
      await storePost(supabase, game.gameId, post, hash);
      result.embedded += 1;
    } catch (err) {
      // 이 글만 건너뛴다. 해시가 저장되지 않았으니 다음 실행이 다시 시도한다.
      console.warn("[policies] 글 임베딩·저장 실패", { gameId: game.gameId, feedId: post.feedId, err });
      result.error = err instanceof EmbeddingError ? "embed_failed" : "store_failed";
    }
  }
  return result;
}

interface SyncOptions {
  /** 경과 시간을 재는 시계(ms). 테스트에서 갈아 끼운다. */
  clock?: () => number;
}

/** 운영정책 주소가 라운지 글인 게임마다 동기화한다. 주소를 지웠거나 바꿔 대상이 아닌 게임의 조각은 지운다. */
export async function syncAllPolicies(supabase: SupabaseClient, options: SyncOptions = {}): Promise<PolicySyncResult[]> {
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const outOfTime = () => clock() - startedAt >= BUDGET_MS;

  const { data, error } = await supabase.from("game_pages").select("game_id, policy_url").not("policy_url", "is", null);
  if (error || !data) {
    console.warn("[policies] 게임 목록 실패", error);
    return [];
  }
  const games: PolicyGame[] = (data as Array<{ game_id: string; policy_url: string | null }>).flatMap((row) => {
    const ref = parseLoungePostUrl(row.policy_url ?? "");
    return ref ? [{ gameId: row.game_id, ...ref }] : [];
  });

  const { data: storedGames, error: storedError } = await supabase.from("policy_chunks").select("game_id");
  if (storedError) {
    console.warn("[policies] 저장된 게임 목록 실패", storedError);
  } else {
    const targets = new Set(games.map((game) => game.gameId));
    const stale = Array.from(new Set((storedGames as Array<{ game_id: string }>).map((row) => row.game_id))).filter((id) => !targets.has(id));
    if (stale.length > 0) {
      const { error: deleteError } = await supabase.from("policy_chunks").delete().in("game_id", stale);
      if (deleteError) console.warn("[policies] 대상이 아닌 게임의 조각 지우기 실패", deleteError);
    }
  }

  const results: PolicySyncResult[] = [];
  for (const game of games) {
    if (outOfTime()) {
      console.warn("[policies] 시간이 모자라 남은 게임을 다음 실행으로 미룸", { gameId: game.gameId });
      break;
    }
    results.push(await syncGamePolicies(supabase, game, outOfTime));
  }
  return results;
}

/** 문의 임베딩과 가까운 운영정책 조각. 실패하면 빈 목록 — 추천은 정책 없이 만든다. */
export async function searchPolicyChunks(supabase: SupabaseClient, gameId: string, embedding: number[], limit = 5): Promise<PolicyChunk[]> {
  const { data, error } = await supabase.rpc("match_policy_chunks", { p_game_id: gameId, p_query: embedding, p_limit: limit });
  if (error || !data) {
    if (error) console.warn("[policies] match_policy_chunks failed", error);
    return [];
  }
  return (data as Array<{ feed_id: number | string; chunk_index: number; title: string; content: string; url: string; similarity: number }>).map((row) => ({
    feedId: Number(row.feed_id),
    chunkIndex: row.chunk_index,
    title: row.title,
    content: row.content,
    url: row.url,
    similarity: row.similarity,
  }));
}
