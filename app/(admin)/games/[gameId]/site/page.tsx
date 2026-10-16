import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import { emptyGamePage, getGamePage, listNotices } from "@/lib/game-pages";
import GamePageEditor from "@/components/site/GamePageEditor";
import NoticeManager from "@/components/site/NoticeManager";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "page", label: "게임 페이지" },
  { key: "notices", label: "공지사항" },
] as const;

export default async function GameSitePage({
  params,
  searchParams,
}: {
  params: { gameId: string };
  searchParams: { tab?: string };
}) {
  const supabase = getSupabaseServerClient();
  const tab = searchParams.tab === "notices" ? "notices" : "page";

  const [games, page, notices] = await Promise.all([
    listGames(supabase),
    getGamePage(supabase, params.gameId),
    tab === "notices" ? listNotices(supabase, params.gameId) : Promise.resolve([]),
  ]);

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

      <nav className="flex gap-1 border-b border-line" aria-label="웹사이트 게임 페이지">
        {TABS.map((item) => {
          const active = item.key === tab;
          return (
            <Link
              key={item.key}
              href={item.key === "page" ? `/games/${params.gameId}/site` : `/games/${params.gameId}/site?tab=notices`}
              aria-current={active ? "page" : undefined}
              className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
                active ? "border-accent text-ink font-semibold" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {tab === "page" ? (
        <GamePageEditor key={current.gameId} page={current} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? null} />
      ) : (
        <NoticeManager gameId={game.id} notices={notices} />
      )}
    </div>
  );
}
