import { GoogleGenAI, ThinkingLevel } from "@google/genai";

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

export type SuggestErrorReason = "not_configured" | "refused" | "failed";

/**
 * 스트리밍 이벤트. 텍스트 조각이 순서대로 오고, 문제가 생기면 error 이벤트가
 * 마지막에 온다. error 앞에 이미 나간 텍스트는 그대로 유효하다(관리자가 살릴지
 * 판단한다).
 */
export type SuggestEvent =
  | { type: "text"; text: string }
  | { type: "error"; reason: SuggestErrorReason };

const SYSTEM_PROMPT = [
  "당신은 게임사 THE PLAY+의 고객지원 담당자입니다.",
  "접수된 문의에 보낼 답변 메일 본문을 한국어로 작성하세요.",
  "",
  "규칙:",
  "- 메일 본문만 출력하세요. 머리말, 설명, 따옴표, 코드블록을 붙이지 마세요.",
  "- 확인되지 않은 사실을 지어내지 마세요. 보상 지급, 환불 승인, 수정 일정처럼",
  "  확인이 필요한 사항은 약속하지 말고 '확인 후 안내드리겠습니다'로 남기세요.",
  "- 참고 템플릿이 주어지면 그 말투와 구조를 따르세요. 템플릿의 제목은 참고용",
  "  이름일 뿐이니 답변 본문에 옮겨 적지 마세요.",
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
    input.templates.forEach((template, index) => {
      // 제목을 대괄호로 감싸면 모델이 본문 머리말로 오해해 그대로 복사한다
      // (실제로 "[환불 안내]"가 답변 첫 줄에 나왔다). 제목은 라벨로만 적고
      // 본문과 시각적으로 분리한다.
      lines.push("", `${index + 1}) 템플릿 이름: ${template.title}`, "본문:", template.content);
    });
  }

  if (input.pastReplies.length > 0) {
    lines.push("", "---", "같은 유형의 과거 답변 예시:");
    for (const reply of input.pastReplies) {
      lines.push("", reply);
    }
  }

  return { system: SYSTEM_PROMPT, userMessage: lines.join("\n") };
}

export async function* streamSuggestion(input: SuggestInput): AsyncGenerator<SuggestEvent> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    yield { type: "error", reason: "not_configured" };
    return;
  }

  const { system, userMessage } = buildSuggestPrompt(input);
  let emitted = false;

  try {
    const ai = new GoogleGenAI({ apiKey });
    // 관리자가 버튼을 누르고 기다리는 화면이라 한 번에 받으면 몇 초간 아무것도
    // 안 보인다. 조각이 오는 대로 흘려보낸다.
    const stream = await ai.models.generateContentStream({
      // 모델 이름은 서버 쪽에서 바뀐다. 그때마다 코드를 고치고 배포할 이유가 없다.
      // gemini-2.5-flash-lite는 신규 사용자에게 더 이상 제공되지 않는다(404).
      model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
      contents: userMessage,
      config: {
        systemInstruction: system,
        maxOutputTokens: 2048,
        // 템플릿 말투를 따라야 하므로 창의성보다 일관성 쪽으로 둔다.
        temperature: 0.4,
        // 답변 한 통 쓰는 데 깊은 사고가 필요 없다.
        //
        // thinkingBudget: 0은 이 모델에서 400 INVALID_ARGUMENT다 — 사고를
        // 끄는 것이 아니라 thinkingLevel로 수준만 낮출 수 있다.
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    });

    for await (const chunk of stream) {
      // 안전 필터 차단은 예외가 아니라 정상 응답으로 돌아온다. 스트리밍에서는
      // 본문 일부가 나간 뒤 중간에 끊길 수도 있다.
      const finishReason = chunk.candidates?.[0]?.finishReason;
      if (finishReason === "SAFETY" || finishReason === "RECITATION") {
        yield { type: "error", reason: "refused" };
        return;
      }

      const text = chunk.text;
      if (text) {
        emitted = true;
        yield { type: "text", text };
      }
    }

    if (!emitted) {
      yield { type: "error", reason: "refused" };
    }
  } catch (error) {
    console.warn("[suggest] Gemini request failed", error);
    yield { type: "error", reason: "failed" };
  }
}
