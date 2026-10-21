import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import { emptyGamePage, getGamePage, listGamePageOrder } from "@/lib/game-pages";
import GamePageEditor from "@/components/site/GamePageEditor";
import SubpageShell from "@/components/layout/SubpageShell";

export const dynamic = "force-dynamic";

export default async function GameSitePage({ params }: { params: { gameId: string } }) {
  const supabase = getSupabaseServerClient();

  const [games, page, order] = await Promise.all([
    listGames(supabase),
    getGamePage(supabase, params.gameId),
    listGamePageOrder(supabase),
  ]);

  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  const current = page ?? emptyGamePage(game.id, game.name);
  // 아직 저장한 적 없는 게임도 순서 목록에서 자리를 정할 수 있게 맨 뒤에 붙인다.
  const pageOrder = order.some((item) => item.gameId === game.id)
    ? order
    : [...order, { gameId: game.id, title: current.titleKo || game.name, published: false }];

  return (
    <SubpageShell
      gameId={game.id}
      gameName={game.name}
      title="웹사이트 게임 페이지"
      badge={
        <span
          className={`inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md text-xs font-semibold tracking-normal shrink-0 ${
            current.published ? "bg-done-wash text-done" : "bg-line-soft text-muted"
          }`}
        >
          {current.published && <span className="w-1.5 h-1.5 rounded-full bg-[#2FA36B]" aria-hidden="true" />}
          {current.published ? "공개 중" : "비공개"}
        </span>
      }
    >
      {/* 아래 여백 없음: 편집기의 저장 바(sticky bottom-0)가 작업면 맨 아래에 붙게 한다. */}
      <GamePageEditor key={current.gameId} page={current} order={pageOrder} loungeId={game.naverLoungeId ?? null} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? null} />
    </SubpageShell>
  );
}
