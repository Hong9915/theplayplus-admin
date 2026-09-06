import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { listGames } from "@/lib/categories";
import { getConversation, insertMessage, listMessages, touchConversation, toHistory } from "@/lib/assistant-store";
import { readSpreadsheet, serializeSheets, SheetError, type Proposal } from "@/lib/sheets";
import { buildAssistantPrompt, formatToday, streamAssistant, type AssistantErrorReason } from "@/lib/assistant";

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "proposal"; messageId: string; proposal: Proposal }
  | { type: "error"; reason: AssistantErrorReason | "save_failed" };

/**
 * 메시지 하나를 보내고 답을 스트리밍한다. 시트 읽기 실패도 스트림의 error 한 줄로
 * 내리는 이유는 suggest 라우트와 같다 — 사용자 메시지는 이미 저장됐고, 화면이
 * 사유별 안내를 띄워야 한다.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { content?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const conversation = await getConversation(supabase, params.id);
  if (!conversation) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  const game = (await listGames(supabase)).find((entry) => entry.id === conversation.gameId);
  if (!game) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  if (!game.sheetId) {
    return NextResponse.json({ success: false, error: "not_configured" }, { status: 400 });
  }
  const sheetId = game.sheetId;
  const conversationId = conversation.id;
  const gameName = game.name;

  const userMessage = await insertMessage(supabase, { conversationId, role: "user", content });
  if (!userMessage) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }
  await touchConversation(supabase, conversationId);

  async function* run(): AsyncGenerator<StreamEvent> {
    let tabs;
    try {
      tabs = await readSpreadsheet(sheetId);
    } catch (error) {
      yield { type: "error", reason: error instanceof SheetError ? error.reason : "sheet_read_failed" };
      return;
    }

    const messages = await listMessages(supabase, conversationId);
    const system = buildAssistantPrompt({ gameName, today: formatToday(), sheetText: serializeSheets(tabs) });

    let text = "";
    let failed = false;
    for await (const event of streamAssistant({ system, history: toHistory(messages), tabs })) {
      if (event.type === "text") {
        text += event.text;
        yield event;
      } else if (event.type === "proposal") {
        const saved = await insertMessage(supabase, {
          conversationId,
          role: "proposal",
          proposal: event.proposal,
          status: "pending",
        });
        if (!saved) {
          yield { type: "error", reason: "save_failed" };
          failed = true;
          break;
        }
        yield { type: "proposal", messageId: saved.id, proposal: event.proposal };
      } else {
        yield event;
        failed = true;
      }
    }

    // 실패로 끝났으면 본문을 남기지 않는다 — 관리자가 같은 질문을 다시 보낸다.
    if (!failed && text.trim()) {
      await insertMessage(supabase, { conversationId, role: "assistant", content: text });
    }
  }

  return new Response(toNdjsonStream(run()), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function toNdjsonStream(events: AsyncGenerator<StreamEvent>): ReadableStream<Uint8Array> {
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
