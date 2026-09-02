import { GoogleGenAI } from "@google/genai";

export interface SuggestInput {
  gameName: string;
  groupLabel: string;
  typeLabel: string;
  title: string;
  content: string;
  gameAccount: string | null;
  companyName: string | null;
  templates: Array<{ title: string; content: string }>;
  pastReplies: string[];
}

export type SuggestResult =
  | { ok: true; text: string }
  | { ok: false; reason: "not_configured" | "refused" | "failed" };

const SYSTEM_PROMPT = [
  "당신은 게임사 THE PLAY+의 고객지원 담당자입니다.",
  "접수된 문의에 보낼 답변 메일 본문을 한국어로 작성하세요.",
  "",
  "규칙:",
  "- 메일 본문만 출력하세요. 머리말, 설명, 따옴표, 코드블록을 붙이지 마세요.",
  "- 확인되지 않은 사실을 지어내지 마세요. 보상 지급, 환불 승인, 수정 일정처럼",
  "  확인이 필요한 사항은 약속하지 말고 '확인 후 안내드리겠습니다'로 남기세요.",
  "- 참고 템플릿이 주어지면 그 말투와 구조를 따르세요.",
  "- 과거 답변 예시가 주어지면 표현 방식을 참고하세요.",
  "- 서명이나 발신자 정보는 붙이지 마세요. 발송 시스템이 처리합니다.",
].join("\n");

/**
 * 프롬프트 조립은 이 기능의 핵심 로직이다. API를 때려야만 테스트할 수 있으면
 * 아무도 고치지 못하므로 순수 함수로 분리한다.
 */
export function buildSuggestPrompt(input: SuggestInput): { system: string; userMessage: string } {
  const lines: string[] = [
    `게임: ${input.gameName}`,
    `문의 종류: ${input.groupLabel}`,
    `문의 유형: ${input.typeLabel}`,
  ];

  if (input.gameAccount) {
    lines.push(`게임 계정: ${input.gameAccount}`);
  }
  if (input.companyName) {
    lines.push(`회사명: ${input.companyName}`);
  }

  lines.push("", `제목: ${input.title}`, "", "문의 내용:", input.content);

  if (input.templates.length > 0) {
    lines.push("", "---", "참고 템플릿:");
    for (const template of input.templates) {
      lines.push("", `[${template.title}]`, template.content);
    }
  }

  if (input.pastReplies.length > 0) {
    lines.push("", "---", "같은 유형의 과거 답변 예시:");
    for (const reply of input.pastReplies) {
      lines.push("", reply);
    }
  }

  return { system: SYSTEM_PROMPT, userMessage: lines.join("\n") };
}

export async function requestSuggestion(input: SuggestInput): Promise<SuggestResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "not_configured" };
  }

  const { system, userMessage } = buildSuggestPrompt(input);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      // 모델 이름은 서버 쪽에서 바뀐다. 그때마다 코드를 고치고 배포할 이유가 없다.
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
      contents: userMessage,
      config: {
        systemInstruction: system,
        maxOutputTokens: 2048,
        // 템플릿 말투를 따라야 하므로 창의성보다 일관성 쪽으로 둔다.
        temperature: 0.4,
        // 답변 한 통 쓰는 데 사고가 필요 없고, 관리자가 버튼을 누르고
        // 기다리는 화면이라 지연이 그대로 보인다.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    // 안전 필터 차단은 예외가 아니라 정상 응답으로 돌아온다.
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === "SAFETY" || finishReason === "RECITATION") {
      return { ok: false, reason: "refused" };
    }

    const text = response.text?.trim();
    if (!text) {
      return { ok: false, reason: "refused" };
    }

    return { ok: true, text };
  } catch (error) {
    console.warn("[suggest] Gemini request failed", error);
    return { ok: false, reason: "failed" };
  }
}
