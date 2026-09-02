import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 같은 게임·같은 유형에서 이미 발송된 답변 본문. 추천 프롬프트가 우리 팀
 * 말투를 따라가게 하는 근거로 쓴다.
 *
 * lib/inquiries.ts에 넣지 않는 이유: 그 파일이 이미 커졌고, 이 조회는
 * 추천 기능만 쓴다.
 */
export async function listRecentRepliesByType(
  supabase: SupabaseClient,
  gameId: string,
  typeKey: string,
  limit = 3
): Promise<string[]> {
  const { data, error } = await supabase
    .from("inquiries")
    .select("reply_content")
    .eq("game_id", gameId)
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
