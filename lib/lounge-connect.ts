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

  // 조회가 실패하면 current가 비어 "이미 같다"로 새어 나간다 — 특히 연결 해제(loungeId = null)가
  // 아무것도 안 하고 성공으로 보인다. 읽지 못했으면 저장 실패로 알린다.
  const { data: current, error: readError } = await supabase.from("games").select("naver_lounge_id").eq("id", gameId).maybeSingle();
  if (readError) {
    console.warn("[lounge-connect] 현재 라운지를 읽지 못함", { gameId, readError });
    return { ok: false, error: "save_failed" };
  }
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

  // 이전 라운지 항목을 먼저 지운다. 지우지 못하면 게임은 그대로 둬 두 라운지의 글이 섞이지 않게 한다.
  const { error: deleteError } = await supabase.from("lounge_items").delete().eq("game_id", gameId);
  if (deleteError) {
    console.warn("[lounge-connect] 이전 라운지 항목을 지우지 못함", { gameId, deleteError });
    return { ok: false, error: "save_failed" };
  }

  const { error } = await supabase.from("games").update({ naver_lounge_id: loungeId, lounge_synced_at: null }).eq("id", gameId);
  if (error) {
    return { ok: false, error: "save_failed" };
  }
  return { ok: true, loungeId };
}
