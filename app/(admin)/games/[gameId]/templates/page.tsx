import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listCategoryLabels, listGames } from "@/lib/categories";
import { listTemplates } from "@/lib/templates";
import TemplateManager from "@/components/templates/TemplateManager";
import SubpageShell from "@/components/layout/SubpageShell";

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
    <SubpageShell gameId={game.id} gameName={game.name} title="답변 템플릿">
      <div className="max-w-[880px] mx-auto px-6 py-6">
        <TemplateManager gameId={params.gameId} templates={templates} typeLabels={labels.typeLabels} />
      </div>
    </SubpageShell>
  );
}
