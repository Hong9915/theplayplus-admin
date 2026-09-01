import type { ReactNode } from "react";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import GameRail from "@/components/layout/GameRail";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = getSupabaseServerClient();
  const games = await listGames(supabase);

  return (
    <div className="min-h-screen flex">
      <GameRail games={games} />
      <main className="flex-1 min-w-0 px-8 py-6">{children}</main>
    </div>
  );
}
