/**
 * Supabase Database Webhook 호출자 검증. 관리자 세션이 아니라 공유 비밀값
 * (x-webhook-secret 헤더)이 INQUIRY_WEBHOOK_SECRET과 같은지 본다.
 * 환경변수가 비어 있으면 모든 호출을 거부한다 — 비밀 없이 열린 엔드포인트가
 * 되면 안 된다.
 *
 * app/api/notify/inquiry/route.ts에도 같은 검사가 있다. 그 라우트는 다른
 * 작업이 진행 중이라 지금은 옮기지 않았다.
 */
export function isWebhookAuthorized(request: Request): boolean {
  const expected = process.env.INQUIRY_WEBHOOK_SECRET;
  if (!expected) {
    return false;
  }
  return request.headers.get("x-webhook-secret") === expected;
}
