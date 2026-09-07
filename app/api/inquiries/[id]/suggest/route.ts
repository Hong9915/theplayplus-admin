import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { getInquiryById } from "@/lib/inquiries";
import { listCategoryLabelsForScope, listGames } from "@/lib/categories";
import { scopeForGameId } from "@/lib/inbox-scope";
import { listTemplates, type TemplateRow } from "@/lib/templates";
import {
  listRecentRepliesByType,
  listSimilarAnsweredReplies,
  mergePastReplies,
  type PastReply,
} from "@/lib/replies";
import { listSources, loadSources, serializeSources, type SourceRow } from "@/lib/assistant-sources";
import { ensureInquiryEmbedding } from "@/lib/embeddings";
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

  // 서비스 문의(game_id null)는 게임·템플릿·운영 자료가 없다. 라벨과 과거 답변은 서비스 스코프로 찾는다.
  const scope = scopeForGameId(inquiry.gameId);
  const [labels, games, templates, sources, embedding] = await Promise.all([
    listCategoryLabelsForScope(supabase, scope),
    scope.kind === "game" ? listGames(supabase) : Promise.resolve([]),
    scope.kind === "game" ? listTemplates(supabase, scope.gameId) : Promise.resolve([] as TemplateRow[]),
    scope.kind === "game" ? listSources(supabase, scope.gameId).catch(() => [] as SourceRow[]) : Promise.resolve([] as SourceRow[]),
    // 지금 문의의 임베딩을 여기서 만들어 둔다. 답변이 붙으면 바로 다음 문의의 근거가 된다.
    ensureInquiryEmbedding(supabase, inquiry),
  ]);

  const game = scope.kind === "game" ? games.find((entry) => entry.id === scope.gameId) : undefined;

  // 근거를 모으다 실패한 것은 본문보다 먼저 알린다. 화면이 결과를 그만큼만 믿게 하려는 것이다.
  const warnings: SuggestEvent[] = [];

  // 운영 자료는 등록된 게 있을 때만 읽는다. 읽기 실패(공유 안 됨·너무 큼·서비스 계정 없음)는
  // 자료 없이 진행하고 어느 자료인지 알린다.
  let sourcesText = "";
  if (sources.length > 0) {
    try {
      sourcesText = serializeSources(await loadSources(sources));
    } catch (error) {
      const sourceTitle = sourceTitleOf(error);
      warnings.push({ type: "warning", reason: "sources_unavailable", ...(sourceTitle ? { sourceTitle } : {}) });
    }
  }

  // 유사 문의는 임베딩이 있어야 찾는다. 없으면 같은 유형 최근 답변만 쓴다.
  let similar: PastReply[] = [];
  if (embedding) {
    similar = await listSimilarAnsweredReplies(supabase, scope, embedding, inquiry.id);
  } else {
    warnings.push({ type: "warning", reason: "similar_unavailable" });
  }
  const recent = similar.length < 2 ? await listRecentRepliesByType(supabase, scope, inquiry.typeKey) : [];
  const pastReplies = mergePastReplies(similar, recent);

  // 해당 유형 템플릿 + 공용 템플릿(type_key가 null)만 근거로 넘긴다.
  const relevant = templates.filter(
    (template) => template.typeKey === null || template.typeKey === inquiry.typeKey
  );

  const events = withWarnings(
    warnings,
    streamSuggestion({
      gameName: game?.name ?? "",
      groupLabel: labels.groupLabels[inquiry.groupKey] ?? inquiry.groupKey,
      typeLabel: labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey,
      title: inquiry.title,
      content: inquiry.content,
      gameAccount: inquiry.gameAccount,
      companyName: inquiry.companyName,
      templates: relevant.map((template) => ({ title: template.title, content: template.content })),
      pastReplies,
      sourcesText,
    })
  );

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

/** SheetError의 sourceTitle. 클래스를 import하면 googleapis가 딸려오므로 모양만 본다. */
function sourceTitleOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "sourceTitle" in error) {
    const title = (error as { sourceTitle?: unknown }).sourceTitle;
    return typeof title === "string" && title !== "" ? title : undefined;
  }
  return undefined;
}

async function* withWarnings(warnings: SuggestEvent[], events: AsyncGenerator<SuggestEvent>): AsyncGenerator<SuggestEvent> {
  for (const warning of warnings) yield warning;
  yield* events;
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
