import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { isWebhookAuthorized } from "@/lib/webhook-secret";
import { findAutoReplyTemplate } from "@/lib/templates";
import { listMessages } from "@/lib/messages";
import { sendInquiryReply, type ReplyableInquiry } from "@/lib/send-reply";

/**
 * 예정 시각이 지난 자동 답변을 보내는 엔드포인트. Supabase pg_cron이 매분
 * 호출한다 (마이그레이션 0014).
 *
 * 새 문의는 접수 시 DB 트리거가 inquiries.auto_reply_due_at을 30분~1시간 뒤
 * 랜덤으로 채운다. 여기서는 그 시각이 지난 건을 claim_due_auto_replies RPC로
 * 가져오는데, RPC가 due_at을 지우면서 행을 돌려주므로 두 호출이 겹쳐도 같은
 * 문의를 두 번 보내지 않는다.
 *
 * 기다리는 사이 관리자가 먼저 답했거나 템플릿이 꺼졌으면 건너뛴다. 발송에
 * 실패하면 5분 뒤로 다시 예약해 다음 호출이 재시도한다.
 */

/** 한 번에 보내는 상한. 서버리스 함수 시간 안에 끝나야 한다. */
const BATCH_LIMIT = 10;
const RETRY_DELAY_MS = 5 * 60 * 1000;

type Outcome = "sent" | "skipped" | "failed";

async function processOne(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  inquiry: ReplyableInquiry
): Promise<Outcome> {
  // 템플릿은 게임별이다. 게임 없이 들어온 문의(사업 제휴 등)는 대상이 아니다.
  if (!inquiry.game_id) {
    return "skipped";
  }

  const messages = await listMessages(supabase, inquiry.id);
  if (messages.some((message) => message.direction === "outbound")) {
    return "skipped";
  }

  const template = await findAutoReplyTemplate(supabase, inquiry.game_id, inquiry.type_key);
  if (!template) {
    return "skipped";
  }

  try {
    await sendInquiryReply(supabase, { inquiry, body: template.content, mode: "auto" });
    return "sent";
  } catch (error) {
    console.error("[auto-reply/run] 자동 답변 발송 실패", inquiry.id, error);
    const retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
    await supabase.from("inquiries").update({ auto_reply_due_at: retryAt }).eq("id", inquiry.id);
    return "failed";
  }
}

export async function POST(request: Request) {
  if (!isWebhookAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("claim_due_auto_replies", { p_limit: BATCH_LIMIT });
  if (error || !data) {
    console.error("[auto-reply/run] 예정 문의 조회 실패", error);
    return NextResponse.json({ success: false, error: "claim_failed" }, { status: 502 });
  }

  const claimed = data as ReplyableInquiry[];
  const counts = { sent: 0, skipped: 0, failed: 0 };
  for (const inquiry of claimed) {
    counts[await processOne(supabase, inquiry)] += 1;
  }

  return NextResponse.json({ success: true, claimed: claimed.length, ...counts });
}
