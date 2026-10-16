import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import { emptyGamePage, getGamePage } from "@/lib/game-pages";
import GamePageEditor from "@/components/site/GamePageEditor";

export const dynamic = "force-dynamic";

export default async function GameSitePage({ params }: { params: { gameId: string } }) {
  const supabase = getSupabaseServerClient();

  const [games, page] = await Promise.all([listGames(supabase), getGamePage(supabase, params.gameId)]);

  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  const current = page ?? emptyGamePage(game.id, game.name);

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-4">
      <Link href={`/games/${params.gameId}/inquiries`} className="text-sm text-muted hover:text-ink transition-colors">
        ← 문의함
      </Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{game.name}</h1>
        <span className="text-sm text-muted">웹사이트 게임 페이지</span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
            current.published ? "bg-emerald-100 text-emerald-700" : "bg-ground text-muted border border-line"
          }`}
        >
          {current.published ? "공개 중" : "비공개"}
        </span>
      </header>

      <GamePageEditor
        key={current.gameId}
        page={current}
        loungeId={game.naverLoungeId ?? null}
        siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? null}
      />
    </div>
  );
}
