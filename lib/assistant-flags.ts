/**
 * 운영 어시스턴트 채팅 켜기/끄기. 기본은 꺼짐 — 2026-09-08 답변 품질이 아직
 * 운영에 쓸 만하지 않아 채팅은 막고, AI 답변 추천이 근거로 쓰는 운영 자료(시트·문서)
 * 연결 화면만 남긴다. 다시 켜려면 환경변수 ASSISTANT_CHAT_ENABLED=1.
 */
export function assistantChatEnabled(): boolean {
  return process.env.ASSISTANT_CHAT_ENABLED === "1";
}

/** 채팅 API가 꺼져 있을 때 돌려주는 응답 본문. 화면은 이 코드를 보고 안내한다. */
export const ASSISTANT_CHAT_DISABLED = { success: false as const, error: "assistant_chat_disabled" as const };
