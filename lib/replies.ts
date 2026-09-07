import type { SupabaseClient } from "@supabase/supabase-js";
import { scopeGameId, type InboxScope } from "@/lib/inbox-scope";

/**
 * 같은 스코프(게임 하나 또는 서비스 문의)·같은 유형에서 이미 발송된 답변 본문.
 * 추천 프롬프트가 우리 팀 말투를 따라가게 하는 근거로 쓴다.
 *
 * lib/inquiries.ts에 넣지 않는 이유: 그 파일이 이미 커졌고, 이 조회는
 * 추천 기능만 쓴다.
 */
export async function listRecentRepliesByType(
  supabase: SupabaseClient,
  scope: InboxScope,
  typeKey: string,
  limit = 3
): Promise<string[]> {
  const gameId = scopeGameId(scope);
  const base = supabase.from("inquiries").select("reply_content");
  const scoped = gameId ? base.eq("game_id", gameId) : base.is("game_id", null);
  const { data, error } = await scoped
    .eq("type_key", typeKey)
    .not("reply_content", "is", null)
    .order("replied_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data
    .map((row) => row.reply_content as string | null)
    .filter((content): content is string => typeof content === "string" && content.trim() !== "");
}

/** 추천 프롬프트에 넣는 과거 답변 한 건. 유사도 검색으로 찾은 것은 문의 요약이 함께 온다. */
export interface PastReply {
  /** 유사도 검색으로 찾은 경우에만 채워진다. 최근 답변 대체 경로에서는 null. */
  inquiryNo: string | null;
  title: string | null;
  /** 과거 문의 본문 앞부분. 모델이 "어떤 문의에 이렇게 답했는지" 보게 한다. */
  excerpt: string | null;
  reply: string;
}

export const PAST_REPLY_EXCERPT_CHARS = 500;

interface MatchRow {
  id: string;
  inquiry_no: string | null;
  title: string | null;
  content: string | null;
  reply_body: string | null;
  similarity: number;
}

/**
 * 같은 스코프에서 내용이 비슷한, 답변이 있는 과거 문의(마이그레이션 0021의 RPC).
 * 임베딩이 없는 문의는 RPC가 걸러낸다. 오류·빈 결과는 []로 돌려 호출부가
 * 최근 답변으로 보충하게 한다.
 */
export async function listSimilarAnsweredReplies(
  supabase: SupabaseClient,
  scope: InboxScope,
  embedding: number[],
  excludeId: string,
  limit = 5
): Promise<PastReply[]> {
  const { data, error } = await supabase.rpc("match_answered_inquiries", {
    p_game_id: scopeGameId(scope),
    p_query: embedding,
    p_exclude_id: excludeId,
    p_limit: limit,
  });

  if (error || !data) {
    if (error) console.warn("[replies] match_answered_inquiries failed", error);
    return [];
  }

  return (data as MatchRow[])
    .filter((row) => typeof row.reply_body === "string" && row.reply_body.trim() !== "")
    .map((row) => ({
      inquiryNo: row.inquiry_no ?? null,
      title: row.title ?? null,
      excerpt: row.content ? row.content.slice(0, PAST_REPLY_EXCERPT_CHARS) : null,
      reply: row.reply_body as string,
    }));
}

/**
 * 유사 답변이 2건 미만이면 같은 유형의 최근 답변으로 보충한다. 백필 전이거나
 * 그 게임에 답변이 적을 때도 근거가 비지 않게 하려는 것이다.
 */
export function mergePastReplies(similar: PastReply[], recent: string[]): PastReply[] {
  if (similar.length >= 2) return similar;
  const seen = new Set(similar.map((entry) => entry.reply));
  const fallback = recent
    .filter((reply) => !seen.has(reply))
    .map((reply) => ({ inquiryNo: null, title: null, excerpt: null, reply }));
  return [...similar, ...fallback];
}
