import OpenAI from "openai";
import type { PastReply } from "@/lib/replies";
import { EVIDENCE_DELIMITER } from "@/lib/suggest-evidence";

export interface SuggestInput {
  gameName: string;
  groupLabel: string;
  typeLabel: string;
  title: string;
  content: string;
  gameAccount: string | null;
  companyName: string | null;
  templates: Array<{ title: string; content: string }>;
  pastReplies: PastReply[];
  /** serializeSources 결과. 자료가 없거나 서비스 문의면 "". */
  sourcesText: string;
}

export type SuggestErrorReason = "not_configured" | "refused" | "failed";
export type SuggestWarningReason = "sources_unavailable" | "similar_unavailable";

/**
 * 스트리밍 이벤트. warning은 라우트가 근거를 모으다 실패한 것을 본문보다 먼저
 * 알리는 용도이고, 텍스트 조각이 순서대로 온 뒤 문제가 생기면 error 이벤트가
 * 마지막에 온다. error 앞에 이미 나간 텍스트는 그대로 유효하다(관리자가 살릴지
 * 판단한다).
 */
export type SuggestEvent =
  | { type: "text"; text: string }
  | { type: "warning"; reason: SuggestWarningReason; sourceTitle?: string }
  | { type: "error"; reason: SuggestErrorReason };

const DEFAULT_MODEL = "gpt-5-mini";

// 규칙은 모든 게임에 같고 자료는 게임마다 같다. 이 순서로 system을 만들어야
// OpenAI 프롬프트 캐시가 앞부분을 재사용한다.
const SYSTEM_RULES = [
  "당신은 게임사 THE PLAY+의 고객지원 담당자입니다.",
  "접수된 문의에 보낼 답변 메일 본문을 한국어로 작성하세요.",
  "",
  "규칙:",
  "- 메일 본문만 출력하세요. 머리말, 설명, 따옴표, 코드블록을 붙이지 마세요.",
  "- 확인되지 않은 사실을 지어내지 마세요. 보상 지급, 환불 승인, 수정 일정처럼",
  "  확인이 필요한 사항은 약속하지 말고 '확인 후 안내드리겠습니다'로 남기세요.",
  "- 참고 자료에 있는 사실(이벤트 기간, 지급 기준, 운영 정책 등)로 답할 수 있으면",
  "  그 사실을 답변에 쓰세요. 자료에 없는 사실은 지어내지 말고 '확인 후 안내드리겠습니다'로 남기세요.",
  "- 참고 템플릿이 주어지면 그 말투와 구조를 따르세요. 템플릿의 제목은 참고용",
  "  이름일 뿐이니 답변 본문에 옮겨 적지 마세요.",
  "- 과거 문의와 답변이 주어지면 표현 방식과 처리 방향을 참고하되, 그때의 계정·금액·날짜를",
  "  이번 답변에 옮겨 적지 마세요.",
  "- 서명이나 발신자 정보는 붙이지 마세요. 발송 시스템이 처리합니다.",
  "",
  "출력 형식:",
  `- 본문을 다 쓴 뒤 다음 줄에 ${EVIDENCE_DELIMITER}를 쓰고, 그 아래에 참고한 자료를 한 줄에 하나씩 적으세요.`,
  "  시트는 'VIP 시트 VIP 탭 7행', 문서는 '운영 가이드 문서 환불 항목', 과거 답변은 '과거 답변 R-20260902-0001'처럼 적으세요.",
  "- 참고한 것이 없으면 구분선 아래에 '없음'이라고 적으세요.",
].join("\n");

/**
 * 프롬프트 조립은 이 기능의 핵심 로직이다. API를 때려야만 테스트할 수 있으면
 * 아무도 고치지 못하므로 순수 함수로 분리한다.
 */
export function buildSuggestPrompt(input: SuggestInput): { system: string; userMessage: string } {
  const system = input.sourcesText.trim() === "" ? SYSTEM_RULES : `${SYSTEM_RULES}\n\n# 참고 자료\n\n${input.sourcesText}`;

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
    lines.push("", "---", "과거 문의와 답변:");
    input.pastReplies.forEach((entry, index) => {
      if (entry.inquiryNo) {
        lines.push("", `${index + 1}) 문의 ${entry.inquiryNo}: ${entry.title ?? ""}`.trimEnd());
        if (entry.excerpt) lines.push(`문의 요약: ${entry.excerpt}`);
        lines.push("보낸 답변:", entry.reply);
      } else {
        lines.push("", `${index + 1}) 같은 유형의 최근 답변:`, entry.reply);
      }
    });
  }

  return { system, userMessage: lines.join("\n") };
}

export async function* streamSuggestion(input: SuggestInput): AsyncGenerator<SuggestEvent> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    yield { type: "error", reason: "not_configured" };
    return;
  }

  const { system, userMessage } = buildSuggestPrompt(input);
  let emitted = false;

  try {
    const client = new OpenAI({ apiKey });
    // 관리자가 버튼을 누르고 기다리는 화면이라 한 번에 받으면 몇 초간 아무것도
    // 안 보인다. 조각이 오는 대로 흘려보낸다.
    const stream = await client.chat.completions.create({
      // 모델 이름은 서버 쪽에서 바뀐다. 어시스턴트와 같은 환경변수를 쓴다.
      model: process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
      stream: true,
      // 답변 한 통 쓰는 데 깊은 사고가 필요 없다. gpt-5 계열은 temperature를
      // 기본값 외로 주면 거절하므로 넣지 않는다.
      reasoning_effort: "minimal",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
    });

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const text = choice.delta?.content;
      if (text) {
        emitted = true;
        yield { type: "text", text };
      }

      // 콘텐츠 필터 차단은 예외가 아니라 finish_reason으로 온다. 본문 일부가
      // 나간 뒤 중간에 끊길 수도 있다.
      if (choice.finish_reason === "content_filter") {
        yield { type: "error", reason: "refused" };
        return;
      }
    }

    if (!emitted) {
      yield { type: "error", reason: "refused" };
    }
  } catch (error) {
    console.warn("[suggest] OpenAI request failed", error);
    yield { type: "error", reason: "failed" };
  }
}
