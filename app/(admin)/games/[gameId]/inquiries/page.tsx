import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { countInquiriesByGame, queryInquiries } from "@/lib/inquiries";
import { parseInquiryListQuery } from "@/lib/inquiry-filters";
import { listCategoryLabels, listGames } from "@/lib/categories";
import InquiryMailbox from "@/components/inquiries/InquiryMailbox";
import DeleteGameButton from "@/components/games/DeleteGameButton";

export const dynamic = "force-dynamic";

export default async function GameInquiriesPage({
  params,
  searchParams,
}: {
  params: { gameId: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const supabase = getSupabaseServerClient();
  const query = parseInquiryListQuery(searchParams);

  const [games, page, labels, totalInquiries] = await Promise.all([
    listGames(supabase),
    queryInquiries(supabase, params.gameId, query),
    listCategoryLabels(supabase, params.gameId),
    countInquiriesByGame(supabase, params.gameId),
  ]);

  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-bold">{game.name}</h1>
        <span className="text-sm text-muted">문의함</span>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            game.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-ground text-muted"
          }`}
        >
          {game.status === "active" ? "서비스중" : "종료"}
        </span>
        <DeleteGameButton gameId={game.id} gameName={game.name} inquiryCount={totalInquiries} />
      </header>
      <InquiryMailbox page={page} query={query} labels={labels} />
    </div>
  );
}
