import type { ReactNode } from "react";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import { countNewInquiriesByGame } from "@/lib/inquiries";
import GameRail from "@/components/layout/GameRail";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = getSupabaseServerClient();
  const [games, newCounts] = await Promise.all([listGames(supabase), countNewInquiriesByGame(supabase)]);

  return (
    <div className="min-h-screen flex">
      <GameRail games={games} newCounts={newCounts} />
      <main className="flex-1 min-w-0 px-8 py-6">{children}</main>
    </div>
  );
}
