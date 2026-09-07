import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import { listConversations, listMessages } from "@/lib/assistant-store";
import { serviceAccountEmail } from "@/lib/sheets";
import AssistantShell from "@/components/assistant/AssistantShell";

export const dynamic = "force-dynamic";

/**
 * 운영 시트 어시스턴트. 관리자 레일 없이 전체 화면을 쓴다(문의함에서 새 탭으로 연다).
 * ?c={conversationId}로 대화를 고른다.
 */
export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: { gameId: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const supabase = getSupabaseServerClient();
  const games = await listGames(supabase);
  const game = games.find((entry) => entry.id === params.gameId);
  if (!game) {
    notFound();
  }

  const conversations = await listConversations(supabase, game.id);
  const requested = typeof searchParams.c === "string" ? searchParams.c : null;
  const selected = requested ? conversations.find((entry) => entry.id === requested) ?? null : null;
  const messages = selected ? await listMessages(supabase, selected.id) : [];

  return (
    <AssistantShell
      game={{ id: game.id, name: game.name, sheetId: game.sheetId }}
      conversations={conversations}
      selectedId={selected?.id ?? null}
      messages={messages.map(({ id, role, content, proposal, status, failureReason, appliedBy, appliedAt, attachments }) => ({
        id,
        role,
        content,
        proposal,
        status,
        failureReason,
        appliedBy,
        appliedAt,
        // 첨부 텍스트는 프롬프트용이라 화면에 내리지 않는다.
        attachments: attachments.map(({ name, size }) => ({ name, size })),
      }))}
      serviceAccountEmail={serviceAccountEmail()}
    />
  );
}
