import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { isWebhookAuthorized } from "@/lib/webhook-secret";
import { syncAllLounges } from "@/lib/lounge-sync";
import { buildLoungeSlackMessage, sendSlackMessage } from "@/lib/slack";

/**
 * 네이버 라운지 동기화 진입점. Supabase pg_cron 잡 lounge-sync-run이 5분마다 부른다(마이그레이션 0024).
 * 새 유저 글·댓글은 게임마다 Slack 메시지 하나로, 그 게임 동기화가 끝나는 대로 보낸다 —
 * 뒤 게임에서 시간이 다 돼도 앞 게임 알림은 이미 나가 있다. Slack은 부가 작업이라 실패해도 200이다.
 */
/** 게임이 여러 개면 네이버 호출(각 10초 타임아웃)이 쌓인다. 동기화 쪽 예산(40초)보다 넉넉히 잡는다. */
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isWebhookAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const origin = new URL(request.url).origin;
  let notified = 0;

  const results = await syncAllLounges(getSupabaseServerClient(), {
    onGameSynced: async (result) => {
      if (!webhookUrl || result.added.length === 0) return;
      try {
        await sendSlackMessage(webhookUrl, buildLoungeSlackMessage({ gameName: result.gameName, items: result.added, listUrl: `${origin}/games/${result.gameId}/lounge` }));
        notified += 1;
      } catch (error) {
        console.error("[lounge/sync] Slack 전송 실패", { gameId: result.gameId, error });
      }
    },
  });

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

  return NextResponse.json({ success: true, results: summary, notified });
}
