import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { isWebhookAuthorized } from "@/lib/webhook-secret";
import { syncAllPolicies } from "@/lib/policies";

/**
 * 운영정책 임베딩 동기화 진입점. Supabase pg_cron 잡 policy-sync-run이 매시간 부른다(마이그레이션 0032).
 * 바뀐 글만 OpenAI로 임베딩하므로 평소에는 게임마다 라운지 호출 두 번으로 끝난다.
 */
/** 첫 실행은 글을 모두 임베딩한다. 동기화 쪽 예산(40초)보다 넉넉히 잡는다. */
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isWebhookAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const results = await syncAllPolicies(getSupabaseServerClient());

  const allFailed = results.length > 0 && results.every((result) => result.error && result.error !== "incomplete");
  if (allFailed) {
    return NextResponse.json({ success: false, error: "sync_failed", results }, { status: 502 });
  }
  return NextResponse.json({ success: true, results });
}
