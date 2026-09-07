import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/require-admin-session";
import { listGames } from "@/lib/categories";
import { getConversation, insertMessage, listMessages, touchConversation, toHistory, type MessageRow } from "@/lib/assistant-store";
import { SheetError, type Proposal } from "@/lib/sheets";
import { listSources, loadSources, serializeSources } from "@/lib/assistant-sources";
import { buildAssistantPrompt, formatToday, streamAssistant, type AssistantErrorReason } from "@/lib/assistant";
import {
  AttachmentError,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_TEXT_CHARS,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  extractAttachmentText,
  serializeAttachments,
  type Attachment,
} from "@/lib/attachments";

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "proposal"; messageId: string; proposal: Proposal }
  | { type: "error"; reason: AssistantErrorReason | "save_failed"; sourceTitle?: string };

/**
 * 메시지 하나를 보내고 답을 스트리밍한다. 시트 읽기 실패도 스트림의 error 한 줄로
 * 내리는 이유는 suggest 라우트와 같다 — 사용자 메시지는 이미 저장됐고, 화면이
 * 사유별 안내를 띄워야 한다.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const input = await parseBody(request);
  if (!input) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }
  const { content, files } = input;
  if (!content && files.length === 0) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return NextResponse.json({ success: false, error: "too_many_files" }, { status: 400 });
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_MESSAGE_ATTACHMENT_BYTES) {
    return NextResponse.json({ success: false, error: "message_too_large" }, { status: 400 });
  }

  let attachments: Attachment[];
  try {
    attachments = await Promise.all(files.map((file) => extractAttachmentText(file)));
  } catch (error) {
    const reason = error instanceof AttachmentError ? error.reason : "file_unreadable";
    return NextResponse.json({ success: false, error: reason }, { status: 400 });
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
  const sources = await listSources(supabase, game.id);
  if (sources.length === 0) {
    return NextResponse.json({ success: false, error: "not_configured" }, { status: 400 });
  }
  const conversationId = conversation.id;
  const gameName = game.name;

  // 첨부는 대화 단위로 프롬프트에 쌓이므로 합계를 잰다. 넘치면 저장 전에 거절해
  // 사용자가 파일을 빼고 다시 보낼 수 있게 한다.
  const earlier = await listMessages(supabase, conversationId);
  const earlierAttachments = earlier.flatMap((message) => message.attachments);
  const totalChars = [...earlierAttachments, ...attachments].reduce((sum, attachment) => sum + attachment.text.length, 0);
  if (attachments.length > 0 && totalChars > MAX_ATTACHMENT_TEXT_CHARS) {
    return NextResponse.json({ success: false, error: "attachments_too_large" }, { status: 400 });
  }

  const inserted = await insertMessage(supabase, {
    conversationId,
    role: "user",
    content,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
  if (!inserted) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }
  const userMessage: MessageRow = inserted;
  await touchConversation(supabase, conversationId);

  async function* run(): AsyncGenerator<StreamEvent> {
    let loaded;
    try {
      loaded = await loadSources(sources);
    } catch (error) {
      if (error instanceof SheetError) {
        yield { type: "error", reason: error.reason, ...(error.sourceTitle ? { sourceTitle: error.sourceTitle } : {}) };
      } else {
        yield { type: "error", reason: "source_read_failed" };
      }
      return;
    }

    const messages = [...earlier, userMessage];
    const system = buildAssistantPrompt({
      gameName,
      today: formatToday(),
      sourcesText: serializeSources(loaded),
      attachmentsText: serializeAttachments(messages.flatMap((message) => message.attachments)),
    });

    let text = "";
    let failed = false;
    for await (const event of streamAssistant({ system, history: toHistory(messages), sources: loaded })) {
      if (event.type === "text") {
        text += event.text;
        yield event;
      } else if (event.type === "proposal") {
        // 실제 발송 순서(본문 먼저, 그다음 제안)로 DB에도 남긴다 — 본문을 뒤로
        // 미루면 화면과 달리 proposal이 assistant 텍스트보다 먼저 저장된다.
        if (text.trim()) {
          const savedText = await insertMessage(supabase, { conversationId, role: "assistant", content: text });
          if (!savedText) {
            yield { type: "error", reason: "save_failed" };
            failed = true;
            break;
          }
          text = "";
        }
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

/**
 * JSON(`{ content }`)과 multipart(`content` + `files`) 둘 다 받는다. 파일이 있을 때만
 * 화면이 multipart로 보낸다. 형식이 틀리면 null.
 */
async function parseBody(request: Request): Promise<{ content: string; files: File[] } | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return null;
    }
    const content = form.get("content");
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);
    return { content: typeof content === "string" ? content.trim() : "", files };
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const body = parsed as { content?: unknown };
  return { content: typeof body.content === "string" ? body.content.trim() : "", files: [] };
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
