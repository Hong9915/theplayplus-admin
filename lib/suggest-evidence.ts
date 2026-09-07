/**
 * 추천 답변의 본문과 근거를 나눈다.
 *
 * 모델은 본문 뒤에 구분선을 쓰고 참고한 자료를 한 줄에 하나씩 적는다. 화면은
 * 본문만 답변에 적용하고 근거는 따로 보여준다. 이 파일은 클라이언트 컴포넌트가
 * import하므로 서버 전용 의존성(openai 등)을 두지 않는다.
 */

export const EVIDENCE_DELIMITER = "=== 근거 ===";

const LIST_MARKER = /^\s*(?:[-•*]|\d+[.)])\s*/;

/** 스트리밍 중에도 매 조각마다 부른다. 끝에 걸친 구분선 조각("=== 근")은 본문에서 떼어 둔다. */
export function splitSuggestion(text: string): { body: string; evidence: string[] } {
  const index = text.indexOf(EVIDENCE_DELIMITER);
  if (index === -1) {
    return { body: trimPartialDelimiter(text), evidence: [] };
  }

  const body = text.slice(0, index);
  const evidence = text
    .slice(index + EVIDENCE_DELIMITER.length)
    .split("\n")
    .map((line) => line.replace(LIST_MARKER, "").trim())
    .filter((line) => line !== "" && line !== "없음");

  return { body, evidence };
}

function trimPartialDelimiter(text: string): string {
  for (let length = EVIDENCE_DELIMITER.length - 1; length > 0; length -= 1) {
    if (text.endsWith(EVIDENCE_DELIMITER.slice(0, length))) {
      return text.slice(0, text.length - length);
    }
  }
  return text;
}
