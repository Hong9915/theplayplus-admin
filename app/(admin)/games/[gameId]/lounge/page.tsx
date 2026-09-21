import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import { listLoungeItems } from "@/lib/lounge-items";
import LoungeItemList from "@/components/lounge/LoungeItemList";

export const dynamic = "force-dynamic";

export default async function LoungePage({ params }: { params: { gameId: string } }) {
  const supabase = getSupabaseServerClient();

  const [games, items] = await Promise.all([listGames(supabase), listLoungeItems(supabase, params.gameId)]);

  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-4">
      <Link href={`/games/${params.gameId}/inquiries`} className="text-sm text-muted hover:text-ink transition-colors">
        ← 문의함
      </Link>
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-bold">{game.name}</h1>
        <span className="text-sm text-muted">네이버 라운지</span>
        {game.naverLoungeId && (
          <a
            href={`https://game.naver.com/lounge/${game.naverLoungeId}/home`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-sm rounded-lg border border-line px-3 py-1.5 hover:bg-ground transition-colors"
          >
            라운지 열기 <span aria-hidden="true">↗</span>
          </a>
        )}
      </header>
      {game.naverLoungeId ? (
        <LoungeItemList gameId={params.gameId} items={items} />
      ) : (
        <p className="text-sm text-muted">연결된 네이버 라운지가 없습니다. 문의함 왼쪽 아래의 &quot;네이버 라운지 연결&quot;에서 라운지 주소를 넣어주세요.</p>
      )}
    </div>
  );
}
