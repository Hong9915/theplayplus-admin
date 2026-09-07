import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { isWebhookAuthorized } from "@/lib/webhook-secret";
import { syncAllMailboxes } from "@/lib/reply-sync";

/**
 * 사용자 회신 자동 동기화 엔드포인트. Supabase pg_cron이 5분마다 호출한다
 * (마이그레이션 0017). 발신 메일함마다 새로 받은 메일을 훑어 문의에 붙이고
 * 결과를 메일함별로 돌려준다. 인증은 자동 답변과 같은 x-webhook-secret.
 *
 * Slack 회신 알림을 붙이려면 여기서 results의 added를 보고 보내면 된다.
 */
export async function POST(request: Request) {
  if (!isWebhookAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const results = await syncAllMailboxes(getSupabaseServerClient());
  const allFailed = results.length > 0 && results.every((result) => result.error);
  if (allFailed) {
    return NextResponse.json({ success: false, error: "sync_failed", results }, { status: 502 });
  }
  return NextResponse.json({ success: true, results });
}
