import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { isWebhookAuthorized } from "@/lib/webhook-secret";
import { findAutoReplyTemplate } from "@/lib/templates";
import { listMessages } from "@/lib/messages";
import { REPLYABLE_INQUIRY_COLUMNS, sendInquiryReply } from "@/lib/send-reply";

/**
 * Supabase Database Webhook 수신 엔드포인트 (inquiries INSERT).
 * 새 문의의 유형에 "자동 발송" 템플릿이 있으면 그 내용을 바로 이메일로 보낸다.
 *
 * 문의 저장은 이미 끝난 뒤 호출되므로 여기서 실패해도 접수 데이터에는 영향이 없다.
 * Slack 알림(/api/notify/inquiry)과 별도 웹훅으로 등록한다.
 *
 * 페이로드에서는 id만 쓰고 나머지는 DB에서 다시 읽는다. 웹훅이 보내는 행의
 * 모양에 기대지 않기 위해서다.
 */

const payloadSchema = z.object({
  type: z.literal("INSERT"),
  table: z.literal("inquiries"),
  record: z.object({ id: z.string() }),
});

function skipped(reason: string) {
  return NextResponse.json({ success: true, sent: false, reason });
}

export async function POST(request: Request) {
  if (!isWebhookAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_payload" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: inquiry, error: fetchError } = await supabase
    .from("inquiries")
    .select(REPLYABLE_INQUIRY_COLUMNS)
    .eq("id", parsed.data.record.id)
    .single();

  if (fetchError || !inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  // 템플릿은 게임별이다. 게임 없이 들어온 문의(사업 제휴 등)는 대상이 아니다.
  if (!inquiry.game_id) {
    return skipped("no_game");
  }

  // 웹훅은 재시도될 수 있다. 이미 나간 답변이 있으면 같은 메일을 두 번 보내지 않는다.
  const messages = await listMessages(supabase, inquiry.id);
  if (messages.some((message) => message.direction === "outbound")) {
    return skipped("already_replied");
  }

  const template = await findAutoReplyTemplate(supabase, inquiry.game_id, inquiry.type_key);
  if (!template) {
    return skipped("no_template");
  }

  try {
    await sendInquiryReply(supabase, { inquiry, body: template.content, mode: "auto" });
  } catch (error) {
    // 발송 실패는 실패로 응답해 Supabase가 재시도할 수 있게 한다.
    console.error("[auto-reply/inquiry] 자동 답변 발송 실패", error);
    return NextResponse.json({ success: false, error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ success: true, sent: true });
}
