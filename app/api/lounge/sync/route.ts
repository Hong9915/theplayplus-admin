import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { isWebhookAuthorized } from "@/lib/webhook-secret";
import { syncAllLounges } from "@/lib/lounge-sync";
import { buildLoungeSlackMessage, sendSlackMessage } from "@/lib/slack";

/**
 * 네이버 라운지 동기화 진입점. Supabase pg_cron 잡 lounge-sync-run이 5분마다 부른다(마이그레이션 0024).
 * 새 유저 글·댓글은 게임마다 Slack 메시지 하나로 알린다. Slack은 부가 작업이라 실패해도 200이다 —
 * 항목은 이미 저장돼 관리자 화면에 보인다.
 */
export async function POST(request: Request) {
  if (!isWebhookAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const results = await syncAllLounges(getSupabaseServerClient());
  const summary = results.map((result) => ({
    gameId: result.gameId,
    fetched: result.fetched,
    added: result.added.length,
    ...(result.error ? { error: result.error } : {}),
  }));

  const allFailed = results.length > 0 && results.every((result) => result.error);
  if (allFailed) {
    return NextResponse.json({ success: false, error: "sync_failed", results: summary }, { status: 502 });
  }

  let notified = 0;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (webhookUrl) {
    const origin = new URL(request.url).origin;
    for (const result of results) {
      if (result.added.length === 0) continue;
      try {
        await sendSlackMessage(webhookUrl, buildLoungeSlackMessage({ gameName: result.gameName, items: result.added, listUrl: `${origin}/games/${result.gameId}/lounge` }));
        notified += 1;
      } catch (error) {
        console.error("[lounge/sync] Slack 전송 실패", { gameId: result.gameId, error });
      }
    }
  }

  return NextResponse.json({ success: true, results: summary, notified });
}
