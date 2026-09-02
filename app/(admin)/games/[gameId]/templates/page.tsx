import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listCategoryLabels, listGames } from "@/lib/categories";
import { listTemplates } from "@/lib/templates";
import TemplateManager from "@/components/templates/TemplateManager";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({ params }: { params: { gameId: string } }) {
  const supabase = getSupabaseServerClient();

  const [games, templates, labels] = await Promise.all([
    listGames(supabase),
    listTemplates(supabase, params.gameId),
    listCategoryLabels(supabase, params.gameId),
  ]);

  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/games/${params.gameId}/inquiries`}
        className="text-sm text-muted hover:text-ink transition-colors"
      >
        ← 문의함
      </Link>
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-bold">{game.name}</h1>
        <span className="text-sm text-muted">답변 템플릿</span>
      </header>
      <TemplateManager gameId={params.gameId} templates={templates} typeLabels={labels.typeLabels} />
    </div>
  );
}
