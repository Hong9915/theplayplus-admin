import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listInquiriesByGame } from "@/lib/inquiries";
import { listCategoryLabels, listGames } from "@/lib/categories";
import InquiryMailbox from "@/components/inquiries/InquiryMailbox";

export const dynamic = "force-dynamic";

export default async function GameInquiriesPage({ params }: { params: { gameId: string } }) {
  const supabase = getSupabaseServerClient();

  const [games, inquiries, labels] = await Promise.all([
    listGames(supabase),
    listInquiriesByGame(supabase, params.gameId),
    listCategoryLabels(supabase, params.gameId),
  ]);

  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-baseline gap-3">
        <h1 className="text-xl font-bold">{game.name}</h1>
        <span className="text-sm text-muted">문의함</span>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            game.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-ground text-muted"
          }`}
        >
          {game.status === "active" ? "서비스중" : "종료"}
        </span>
      </header>
      <InquiryMailbox inquiries={inquiries} labels={labels} />
    </div>
  );
}
