import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { sendReplyEmail } from "@/lib/gmail";
import { getAdminSession } from "@/lib/require-admin-session";
import { recordEvent } from "@/lib/events";
import { createOutboundMessage, listRfcMessageIds } from "@/lib/messages";

const replySchema = z.object({ replyContent: z.string().trim().min(1).max(5000) });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const actor = await getAdminSession();
  if (!actor) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_reply" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: inquiry, error: fetchError } = await supabase
    .from("inquiries")
    .select("id, reply_email, title, inquiry_no, gmail_thread_id")
    .eq("id", params.id)
    .single();

  if (fetchError || !inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  // 접수번호를 제목에 넣어 사용자가 메일로 다시 문의해도 건을 특정할 수 있게 한다.
  // 같은 제목이어야 Gmail이 후속 답변을 같은 스레드로 묶는다.
  const subject = inquiry.inquiry_no ? `[${inquiry.inquiry_no}] Re: ${inquiry.title}` : `Re: ${inquiry.title}`;

  // 이전에 오간 메일이 있으면 그 Message-ID를 참조해 같은 스레드에 붙인다.
  const references = await listRfcMessageIds(supabase, params.id).catch(() => [] as string[]);

  let sent;
  try {
    sent = await sendReplyEmail({
      to: inquiry.reply_email,
      subject,
      body: parsed.data.replyContent,
      threadId: inquiry.gmail_thread_id ?? null,
      references,
    });
  } catch {
    return NextResponse.json({ success: false, error: "send_failed" }, { status: 500 });
  }

  const sentAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("inquiries")
    .update({
      // 답변을 보냈다고 끝난 건 아니다. 사용자 회신이나 후속 확인이 남을 수
      // 있으니 처리중으로 두고, 완료는 관리자가 직접 바꾼다.
      status: "in_progress",
      // reply_content는 "마지막 답변"이다. 전체 기록은 inquiry_messages에 쌓인다.
      reply_content: parsed.data.replyContent,
      replied_at: sentAt,
      // 발송했으니 초안은 비운다.
      draft_reply: null,
      gmail_thread_id: sent.gmailThreadId || inquiry.gmail_thread_id || null,
    })
    .eq("id", params.id);

  if (updateError) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  // 메일은 이미 나갔으므로 기록 실패로 발송을 되돌릴 수는 없다. 대신 경고를
  // 내려 관리자가 스레드에 빠진 답변이 있음을 알게 한다.
  const recorded = await createOutboundMessage(supabase, {
    inquiryId: params.id,
    author: actor,
    body: parsed.data.replyContent,
    gmailMessageId: sent.gmailMessageId || null,
    rfcMessageId: sent.rfcMessageId,
    sentAt,
  }).catch(() => false);

  // 이력 적재는 부가 작업이다. 실패해도 이미 나간 메일을 되돌릴 수 없다.
  await recordEvent(supabase, { inquiryId: params.id, actor, kind: "reply_sent" }).catch(() => {});

  return NextResponse.json({ success: true, ...(recorded ? {} : { warning: "message_save_failed" }) });
}
