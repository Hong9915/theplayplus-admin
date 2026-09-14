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
import { listMessages, type MessageRow } from "@/lib/messages";
import { listNotes, type NoteRow } from "@/lib/notes";
import { streamSuggestion, type ConversationEntry, type SuggestEvent } from "@/lib/suggest";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);
  if (!inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  // 키가 없으면 시트·템플릿·임베딩을 읽을 필요가 없다. 바로 같은 NDJSON 형태의
  // error 이벤트 하나로 끝낸다 — 화면이 다른 오류와 똑같이 처리할 수 있게.
  if (!process.env.OPENAI_API_KEY) {
    return new Response(
      toNdjsonStream(
        (async function* (): AsyncGenerator<SuggestEvent> {
          yield { type: "error", reason: "not_configured" };
        })()
      ),
      {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  // 서비스 문의(game_id null)는 게임·템플릿·운영 자료가 없다. 라벨과 과거 답변은 서비스 스코프로 찾는다.
  const scope = scopeForGameId(inquiry.gameId);
  // 작성란의 초안은 관리자가 원하는 답변이라 화면에서 그대로 받는다. DB의 draft_reply는
  // 자동 저장이 몇 초 늦어 버튼을 누른 순간의 글과 다를 수 있다.
  const draft = await readDraft(request);

  const [labels, games, templates, sources, embedding, messages, notes] = await Promise.all([
    listCategoryLabelsForScope(supabase, scope),
    scope.kind === "game" ? listGames(supabase) : Promise.resolve([]),
    scope.kind === "game" ? listTemplates(supabase, scope.gameId) : Promise.resolve([] as TemplateRow[]),
    scope.kind === "game" ? listSources(supabase, scope.gameId).catch(() => [] as SourceRow[]) : Promise.resolve([] as SourceRow[]),
    // 지금 문의의 임베딩을 여기서 만들어 둔다. 답변이 붙으면 바로 다음 문의의 근거가 된다.
    ensureInquiryEmbedding(supabase, inquiry),
    // 이 문의에 이미 오간 답변·회신·메모. 못 읽어도 추천은 만든다 — 근거가 하나 빠질 뿐이다.
    listMessages(supabase, inquiry.id).catch(() => [] as MessageRow[]),
    listNotes(supabase, inquiry.id).catch(() => [] as NoteRow[]),
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
      templates: relevant.map((template) => ({ title: template.title, content: template.content, autoSend: template.autoSend })),
      pastReplies,
      sourcesText,
      conversation: buildConversation(messages, notes),
      draft,
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

/** 본문의 `draft`. 본문이 없거나 JSON이 아니거나 문자열이 아니면 빈 초안으로 본다. */
async function readDraft(request: Request): Promise<string> {
  try {
    const json: unknown = await request.json();
    if (typeof json === "object" && json !== null && "draft" in json) {
      const draft = (json as { draft?: unknown }).draft;
      if (typeof draft === "string") return draft;
    }
  } catch {
    // 본문 없음 또는 JSON 아님
  }
  return "";
}

/** 메시지와 메모를 시간순 한 줄기로 합친다. 같은 시각이면 메시지가 먼저다(안정 정렬). */
function buildConversation(messages: MessageRow[], notes: NoteRow[]): ConversationEntry[] {
  const entries: ConversationEntry[] = [
    ...messages.map(
      (message): ConversationEntry => ({
        kind: message.direction === "inbound" ? "inbound" : message.autoSent ? "auto" : "outbound",
        at: message.sentAt,
        body: message.body,
      })
    ),
    ...notes.map((note): ConversationEntry => ({ kind: "note", at: note.createdAt, body: note.content })),
  ];
  return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/**
 * SheetError의 sourceTitle. 클래스를 import하지 않고 모양만 보는 이유는 라우트
 * 테스트가 assistant-sources를 통째로 모킹해 실제 클래스를 쓸 수 없어서다.
 */
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
