import type { SupabaseClient } from "@supabase/supabase-js";
import { countNewInquiriesByGame } from "@/lib/inquiries";
import { countUnreadLoungeItemsByGame } from "@/lib/lounge-items";

/** 브라우저 탭 제목 앞에 붙는 "(N) " 부분. 천 단위 쉼표도 받는다. */
const TITLE_COUNT_PREFIX = /^\(\d[\d,]*\)\s+/;

export function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, n) => total + n, 0);
}

/**
 * 회신이 와 있는데 상태가 접수(new)가 아닌 문의 수. 접수 문의는 이미 따로 세므로
 * 빼서 한 문의가 두 번 더해지지 않게 한다. 실패하면 0.
 */
export async function countUnreadRepliesOutsideNew(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("inquiries")
    .select("id", { count: "exact", head: true })
    .not("unread_reply_at", "is", null)
    .neq("status", "new");
  if (error || count == null) return 0;
  return count;
}

/**
 * 관리자에게 와 있는 알림 전체 수: 접수 문의(게임+서비스) + 회신 옴 + 라운지 새 글.
 * 탭 제목의 "(N)"에 쓴다. 이미 게임별 건수를 가진 쪽은 `known`으로 넘겨 다시 읽지 않는다.
 */
export async function countAdminNotifications(
  supabase: SupabaseClient,
  known?: { newCounts: Record<string, number>; loungeCounts: Record<string, number> }
): Promise<number> {
  const [newCounts, loungeCounts, unreadReplies] = await Promise.all([
    known ? known.newCounts : countNewInquiriesByGame(supabase),
    known ? known.loungeCounts : countUnreadLoungeItemsByGame(supabase),
    countUnreadRepliesOutsideNew(supabase),
  ]);
  return sumCounts(newCounts) + sumCounts(loungeCounts) + unreadReplies;
}

/** 탭 제목에 건수를 붙인다. 0이면 원래 제목만. 이미 붙은 건수는 바꿔 끼운다. */
export function withTitleCount(title: string, count: number): string {
  const base = title.replace(TITLE_COUNT_PREFIX, "");
  if (count <= 0) return base;
  return `(${count.toLocaleString("en-US")}) ${base}`;
}
