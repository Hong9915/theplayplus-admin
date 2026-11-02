import type { ReactNode } from "react";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import { countNewInquiriesByGame } from "@/lib/inquiries";
import { countUnreadLoungeItemsByGame } from "@/lib/lounge-items";
import GameRail from "@/components/layout/GameRail";
import RealtimeRefresh from "@/components/layout/RealtimeRefresh";
import TitleCount from "@/components/layout/TitleCount";
import { countAdminNotifications } from "@/lib/notification-count";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = getSupabaseServerClient();
  const [games, newCounts, loungeCounts] = await Promise.all([
    listGames(supabase),
    countNewInquiriesByGame(supabase),
    countUnreadLoungeItemsByGame(supabase),
  ]);
  const notificationCount = await countAdminNotifications(supabase, { newCounts, loungeCounts });

  return (
    <div className="min-h-screen flex">
      <RealtimeRefresh />
      <TitleCount count={notificationCount} />
      <GameRail games={games} newCounts={newCounts} loungeCounts={loungeCounts} />
      {/* relative: 안쪽 스크롤 영역의 sr-only(absolute) 요소가 main 밖으로 나가 문서 전체를 길게 만들지 않게 가둔다. */}
      <main id="main" tabIndex={-1} className="relative flex-1 min-w-0 h-dvh overflow-x-auto overflow-y-hidden flex focus:outline-none">
        {children}
      </main>
    </div>
  );
}
