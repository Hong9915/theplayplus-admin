import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const supabase = getSupabaseServerClient();
  const games = await listGames(supabase);

  if (games.length > 0) {
    redirect(`/games/${games[0].id}/inquiries`);
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6 flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-panel border border-dashed border-line flex items-center justify-center text-2xl text-muted">
          +
        </div>
        <h1 className="text-lg font-bold mb-1">등록된 게임이 없습니다</h1>
        <p className="text-sm text-muted">
          왼쪽 사이드바의 <span className="font-semibold text-ink">+</span> 버튼으로 첫 게임을 추가하면 문의함이
          열립니다.
        </p>
      </div>
    </div>
  );
}
