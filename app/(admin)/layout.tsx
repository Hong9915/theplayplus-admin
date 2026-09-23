import type { ReactNode } from "react";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import { countNewInquiriesByGame } from "@/lib/inquiries";
import { countUnreadLoungeItemsByGame } from "@/lib/lounge-items";
import GameRail from "@/components/layout/GameRail";
import RealtimeRefresh from "@/components/layout/RealtimeRefresh";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = getSupabaseServerClient();
  const [games, newCounts, loungeCounts] = await Promise.all([
    listGames(supabase),
    countNewInquiriesByGame(supabase),
    countUnreadLoungeItemsByGame(supabase),
  ]);

  return (
    <div className="min-h-screen flex">
      <RealtimeRefresh />
      <GameRail games={games} newCounts={newCounts} loungeCounts={loungeCounts} />
      <main id="main" tabIndex={-1} className="flex-1 min-w-0 h-screen overflow-x-auto overflow-y-hidden flex focus:outline-none">
        {children}
      </main>
    </div>
  );
}
