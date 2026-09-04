/**
 * 인박스가 다루는 범위. 게임 하나이거나, 게임 없이 접수된 서비스 문의(제휴·기타)다.
 * 서비스 문의는 inquiries.game_id가 null이고 URL은 /service/inquiries 아래에 있다.
 */
export type InboxScope = { kind: "game"; gameId: string } | { kind: "service" };

export const SERVICE_SCOPE: InboxScope = { kind: "service" };

/** countNewInquiriesByGame이 서비스 문의 건수를 담는 키. 게임 id는 uuid라 충돌하지 않는다. */
export const SERVICE_RAIL_KEY = "service";

export const SERVICE_SCOPE_TITLE = "서비스 문의";

export function gameScope(gameId: string): InboxScope {
  return { kind: "game", gameId };
}

/** 문의 행의 game_id로 그 문의가 속한 스코프를 정한다. */
export function scopeForGameId(gameId: string | null): InboxScope {
  return gameId ? gameScope(gameId) : SERVICE_SCOPE;
}

/** URL 앞부분. 뒤에 /inquiries, /templates 등이 붙는다. */
export function scopeBasePath(scope: InboxScope): string {
  return scope.kind === "game" ? `/games/${scope.gameId}` : "/service";
}

/** DB 쿼리·RPC에 넘길 game_id 값. 서비스는 null. */
export function scopeGameId(scope: InboxScope): string | null {
  return scope.kind === "game" ? scope.gameId : null;
}

export function inquiryBelongsToScope(scope: InboxScope, gameId: string | null): boolean {
  return scopeGameId(scope) === gameId;
}
