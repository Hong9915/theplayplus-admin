import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import { listLoungeItems } from "@/lib/lounge-items";
import LoungeItemList from "@/components/lounge/LoungeItemList";
import SubpageShell, { SUBPAGE_ACTION } from "@/components/layout/SubpageShell";

export const dynamic = "force-dynamic";

export default async function LoungePage({ params }: { params: { gameId: string } }) {
  const supabase = getSupabaseServerClient();

  const [games, items] = await Promise.all([listGames(supabase), listLoungeItems(supabase, params.gameId)]);

  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  return (
    <SubpageShell
      gameId={game.id}
      gameName={game.name}
      title="네이버 라운지"
      actions={
        game.naverLoungeId && (
          <a href={`https://game.naver.com/lounge/${game.naverLoungeId}/home`} target="_blank" rel="noopener noreferrer" className={SUBPAGE_ACTION}>
            라운지 열기
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
          </a>
        )
      }
    >
      <div className="max-w-[820px] mx-auto px-6 py-6">
        {game.naverLoungeId ? (
          <LoungeItemList gameId={params.gameId} items={items} />
        ) : (
          <p className="py-16 text-center text-[14px] text-muted">
            연결된 네이버 라운지가 없습니다. 문의함의 &lsquo;게임 설정 → 네이버 라운지 연결&rsquo;에서 라운지 주소를 넣어주세요.
          </p>
        )}
      </div>
    </SubpageShell>
  );
}
