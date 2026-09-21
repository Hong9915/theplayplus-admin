import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLoungePosts, parseLoungeId } from "@/lib/naver-lounge";

export type ConnectLoungeResult =
  | { ok: true; loungeId: string | null }
  | { ok: false; error: "invalid_lounge" | "lounge_unreachable" | "save_failed" };

/**
 * 게임에 네이버 라운지를 연결한다. 게임 추가와 연결 대화상자(PATCH)가 같이 쓴다.
 * 빈 입력은 연결 해제다. 저장 전에 라운지를 실제로 한 번 읽어 주소가 맞는지 확인한다.
 * 라운지가 바뀌면 이전 라운지의 항목을 지우고 동기화 기준도 되돌려 첫 실행처럼 다시 시작한다.
 */
export async function connectLounge(supabase: SupabaseClient, gameId: string, input: string): Promise<ConnectLoungeResult> {
  const trimmed = input.trim();
  const loungeId = trimmed ? parseLoungeId(trimmed) : null;
  if (trimmed && !loungeId) {
    return { ok: false, error: "invalid_lounge" };
  }

  const { data: current } = await supabase.from("games").select("naver_lounge_id").eq("id", gameId).maybeSingle();
  if ((current?.naver_lounge_id ?? null) === loungeId) {
    return { ok: true, loungeId };
  }

  if (loungeId) {
    try {
      await fetchLoungePosts(loungeId);
    } catch (error) {
      console.warn("[lounge-connect] 라운지를 읽지 못함", { gameId, loungeId, error });
      return { ok: false, error: "lounge_unreachable" };
    }
  }

  const { error } = await supabase.from("games").update({ naver_lounge_id: loungeId, lounge_synced_at: null }).eq("id", gameId);
  if (error) {
    return { ok: false, error: "save_failed" };
  }
  await supabase.from("lounge_items").delete().eq("game_id", gameId);
  return { ok: true, loungeId };
}
