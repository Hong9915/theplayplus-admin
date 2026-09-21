import type { SupabaseClient } from "@supabase/supabase-js";

/** 네이버 라운지에서 가져온 글·댓글 한 건. read_at이 null이면 관리자가 아직 안 본 유저 항목이다. */
export interface LoungeItemRow {
  id: string;
  gameId: string;
  kind: "post" | "comment";
  naverId: number;
  feedId: number;
  title: string;
  body: string;
  boardName: string | null;
  nickname: string | null;
  isUser: boolean;
  url: string;
  postedAt: string;
  readAt: string | null;
}

export function mapLoungeItem(row: Record<string, unknown>): LoungeItemRow {
  return {
    id: row.id as string,
    gameId: row.game_id as string,
    kind: row.kind as LoungeItemRow["kind"],
    naverId: Number(row.naver_id),
    feedId: Number(row.feed_id),
    title: row.title as string,
    body: (row.body as string) ?? "",
    boardName: (row.board_name as string | null) ?? null,
    nickname: (row.nickname as string | null) ?? null,
    isUser: Boolean(row.is_user),
    url: row.url as string,
    postedAt: row.posted_at as string,
    readAt: (row.read_at as string | null) ?? null,
  };
}

export async function listLoungeItems(supabase: SupabaseClient, gameId: string, limit = 100): Promise<LoungeItemRow[]> {
  const { data, error } = await supabase
    .from("lounge_items")
    .select("*")
    .eq("game_id", gameId)
    .order("posted_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map(mapLoungeItem);
}

/** 건수는 부가 정보다. 실패하면 null을 돌려 화면이 건수 없이 그리게 한다. */
export async function countUnreadLoungeItems(supabase: SupabaseClient, gameId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("lounge_items")
    .select("id", { count: "exact", head: true })
    .eq("game_id", gameId)
    .is("read_at", null);
  return error ? null : count ?? 0;
}

/** 게임 레일 배지용. 실패하면 빈 객체. */
export async function countUnreadLoungeItemsByGame(supabase: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("lounge_items").select("game_id").is("read_at", null);
  if (error || !data) return {};
  const counts: Record<string, number> = {};
  for (const row of data as Array<{ game_id: string }>) {
    counts[row.game_id] = (counts[row.game_id] ?? 0) + 1;
  }
  return counts;
}

export async function markLoungeItemRead(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("lounge_items").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  return !error;
}

export async function markAllLoungeItemsRead(supabase: SupabaseClient, gameId: string): Promise<boolean> {
  const { error } = await supabase.from("lounge_items").update({ read_at: new Date().toISOString() }).eq("game_id", gameId).is("read_at", null);
  return !error;
}
