import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import GamesPageClient from "@/components/games/GamesPageClient";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const supabase = getSupabaseServerClient();
  const games = await listGames(supabase);

  return (
    <>
      <h1 className="text-2xl font-bold mb-6">게임 관리</h1>
      <GamesPageClient games={games} />
    </>
  );
}
