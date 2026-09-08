import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { listCategoryLabelsForScope, type CategoryLabelMaps } from "@/lib/categories";
import { SERVICE_SCOPE_TITLE, scopeBasePath, scopeForGameId } from "@/lib/inbox-scope";
import { buildInquirySlackMessage, sendSlackMessage } from "@/lib/slack";

/**
 * Supabase Database Webhook 수신 엔드포인트.
 * `inquiries` 테이블 INSERT 시 호출되어 새 문의를 Slack 채널로 알린다.
 *
 * 문의 저장은 이미 끝난 뒤 호출되므로 여기서 실패해도 접수 데이터에는 영향이 없다.
 * 관리자 세션이 아니라 공유 비밀값(x-webhook-secret 헤더)으로 호출자를 검증한다.
 *
 * 알림 대상은 긴급(urgent) 게임 문의와 모든 서비스 문의뿐이다. 우선순위는
 * before insert 트리거(마이그레이션 0009)가 유형의 default_priority로 정해 두므로
 * 웹훅 payload의 record.priority가 이미 최종값이다. 서비스 문의(game_id null)는
 * 그 규칙이 없어 항상 'normal'로 들어오기 때문에 우선순위를 보지 않고 전부 보낸다.
 */

const payloadSchema = z.object({
  type: z.literal("INSERT"),
  table: z.literal("inquiries"),
  record: z.object({
    id: z.string(),
    inquiry_no: z.string().nullish(),
    game_id: z.string().nullish(),
    group_key: z.string(),
    type_key: z.string(),
    game_account: z.string().nullish(),
    title: z.string(),
    priority: z.string().nullish(),
  }),
});

function isAuthorized(request: Request): boolean {
  const expected = process.env.INQUIRY_WEBHOOK_SECRET;
  if (!expected) {
    return false;
  }
  return request.headers.get("x-webhook-secret") === expected;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_payload" }, { status: 400 });
  }

  const { record } = parsed.data;
  const scope = scopeForGameId(record.game_id ?? null);
  if (scope.kind === "game" && record.priority !== "urgent") {
    return NextResponse.json({ success: true, notified: false, skipped: "not_urgent" });
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ success: true, notified: false });
  }

  const supabase = getSupabaseServerClient();
  const EMPTY: CategoryLabelMaps = { groupLabels: {}, typeLabels: {}, typeOrder: [] };

  // 라벨·게임명 조회는 부가 정보다. 실패하면 키를 그대로 보여주고 알림은 계속 보낸다.
  // 서비스 문의(game_id null)는 게임이 없으므로 게임명 대신 고정 제목을 쓴다.
  const [gameName, labels] = await Promise.all([
    scope.kind === "game"
      ? supabase
          .from("games")
          .select("name")
          .eq("id", scope.gameId)
          .single()
          .then((result) => result.data?.name ?? "알 수 없는 게임")
      : Promise.resolve(SERVICE_SCOPE_TITLE),
    listCategoryLabelsForScope(supabase, scope).catch((): CategoryLabelMaps => EMPTY),
  ]);

  const message = buildInquirySlackMessage({
    gameName,
    inquiryNo: record.inquiry_no ?? null,
    groupLabel: labels.groupLabels[record.group_key] ?? record.group_key,
    typeLabel: labels.typeLabels[record.type_key] ?? record.type_key,
    title: record.title,
    gameAccount: record.game_account ?? null,
    detailUrl: `${new URL(request.url).origin}${scopeBasePath(scope)}/inquiries/${record.id}`,
  });

  try {
    await sendSlackMessage(webhookUrl, message);
  } catch (error) {
    console.error("[notify/inquiry] Slack 전송 실패", error);
    return NextResponse.json({ success: false, error: "slack_failed" }, { status: 502 });
  }

  return NextResponse.json({ success: true, notified: true });
}
