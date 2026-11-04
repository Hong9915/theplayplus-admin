import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import { listGameCategorySettings, type CategoryGroupSetting } from "@/lib/category-settings";
import CategoryManager from "@/components/categories/CategoryManager";
import SubpageShell from "@/components/layout/SubpageShell";

export const dynamic = "force-dynamic";

export default async function CategoriesPage({ params }: { params: { gameId: string } }) {
  const supabase = getSupabaseServerClient();

  const [games, groups] = await Promise.all([
    listGames(supabase),
    // 못 읽으면 빈 목록으로 그리지 않는다 — 빈 화면은 "종류가 없다"로 읽혀 새로 만들게 한다.
    listGameCategorySettings(supabase, params.gameId).catch((): CategoryGroupSetting[] | null => null),
  ]);

  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  return (
    <SubpageShell gameId={game.id} gameName={game.name} title="문의 유형">
      <div className="max-w-[920px] mx-auto px-6 py-6">
        {groups === null ? (
          <p className="py-16 text-center text-[14px] text-muted">문의 유형을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</p>
        ) : (
          <CategoryManager gameId={game.id} groups={groups} />
        )}
      </div>
    </SubpageShell>
  );
}
