import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { getInquiryById } from "@/lib/inquiries";
import { listCategoryLabelsForScope, listGames } from "@/lib/categories";
import { scopeForGameId } from "@/lib/inbox-scope";
import { listTemplates, type TemplateRow } from "@/lib/templates";
import { listRecentRepliesByType } from "@/lib/replies";
import { streamSuggestion, type SuggestEvent } from "@/lib/suggest";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);
  if (!inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  // 서비스 문의(game_id null)는 게임·템플릿이 없다. 라벨과 과거 답변은 서비스 스코프로 찾는다.
  const scope = scopeForGameId(inquiry.gameId);
  const [labels, games, templates, pastReplies] = await Promise.all([
    listCategoryLabelsForScope(supabase, scope),
    scope.kind === "game" ? listGames(supabase) : Promise.resolve([]),
    scope.kind === "game" ? listTemplates(supabase, scope.gameId) : Promise.resolve([] as TemplateRow[]),
    listRecentRepliesByType(supabase, scope, inquiry.typeKey),
  ]);

  const game = scope.kind === "game" ? games.find((entry) => entry.id === scope.gameId) : undefined;

  // 해당 유형 템플릿 + 공용 템플릿(type_key가 null)만 근거로 넘긴다.
  const relevant = templates.filter(
    (template) => template.typeKey === null || template.typeKey === inquiry.typeKey
  );

  const events = streamSuggestion({
    gameName: game?.name ?? "",
    groupLabel: labels.groupLabels[inquiry.groupKey] ?? inquiry.groupKey,
    typeLabel: labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey,
    title: inquiry.title,
    content: inquiry.content,
    gameAccount: inquiry.gameAccount,
    companyName: inquiry.companyName,
    templates: relevant.map((template) => ({ title: template.title, content: template.content })),
    pastReplies,
  });

  // 추천은 이력에 남기지 않는다 — 초안 생성일 뿐이고 여러 번 눌린다.
  //
  // 한 줄에 이벤트 하나(NDJSON). 텍스트 조각은 오는 대로 내려보내고, 실패 원인
  // (not_configured / refused / failed)도 같은 스트림의 error 이벤트로 내려야
  // 화면이 관리자에게 무엇을 고쳐야 할지 알려줄 수 있다. 본문이 이미 일부 나간
  // 뒤에는 상태 코드를 바꿀 수 없기 때문이다.
  return new Response(toNdjsonStream(events), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function toNdjsonStream(events: AsyncGenerator<SuggestEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await events.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
    },
    async cancel() {
      await events.return(undefined);
    },
  });
}
