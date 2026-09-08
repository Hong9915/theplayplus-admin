import OpenAI from "openai";
import type { PastReply } from "@/lib/replies";
import { EVIDENCE_DELIMITER } from "@/lib/suggest-evidence";
import { DISPLAY_TIME_ZONE } from "@/lib/format";

/** 이 문의에 이미 오간 것 하나. 프롬프트에 시간순으로 싣는다. */
export interface ConversationEntry {
  /** outbound: 관리자가 보낸 답변, auto: 매크로 자동 답변, inbound: 사용자 회신, note: 내부 메모 */
  kind: "outbound" | "auto" | "inbound" | "note";
  at: string;
  body: string;
}

/** 대화 항목 하나의 길이 상한. 첨부 본문이 통째로 회신에 붙어 오는 경우가 있다. */
export const CONVERSATION_ENTRY_MAX_CHARS = 2000;
/** 실어 보내는 대화 항목 수. 오래된 것부터 뺀다. */
export const CONVERSATION_MAX_ENTRIES = 20;
/** 초안 상한. 초안 저장 라우트(`/draft`)의 스키마와 같은 값이다. */
export const DRAFT_MAX_CHARS = 5000;

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
  /** 이 문의의 보낸 답변·자동 답변·사용자 회신·내부 메모, 시간순. */
  conversation: ConversationEntry[];
  /** 작성란에 지금 적혀 있는 답변 초안. 없으면 "". */
  draft: string;
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
  "- '작성 중인 답변 초안'이 주어지면 그것이 관리자가 원하는 답변입니다. 가장 우선합니다.",
  "  초안에 적힌 사실·결정·방향을 그대로 유지하고, 정중한 메일 문장으로 다듬고 빠진 인사·맺음만",
  "  채우세요. 초안과 다른 내용을 새로 지어 붙이거나 초안의 결정을 뒤집지 마세요.",
  "- '이 문의의 대화 이력'이 주어지면 이번 답변은 그 뒤에 이어지는 후속 답변입니다.",
  "  마지막 사용자 회신에 답하고, 이미 안내한 내용을 처음부터 다시 설명하지 마세요.",
  "- 대화 이력의 '내부 메모'는 관리자끼리 적은 사실 확인용입니다. 거기 적힌 사실은 참고하되",
  "  메모 문장을 답변에 옮겨 적지 마세요.",
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

  if (input.conversation.length > 0) {
    lines.push("", "---", "이 문의의 대화 이력 (시간순):");
    const dropped = Math.max(0, input.conversation.length - CONVERSATION_MAX_ENTRIES);
    if (dropped > 0) lines.push(`(앞의 ${dropped}건은 생략)`);
    input.conversation.slice(dropped).forEach((entry) => {
      lines.push("", `[${CONVERSATION_LABELS[entry.kind]} · ${formatPromptTime(entry.at)}]`, clip(entry.body, CONVERSATION_ENTRY_MAX_CHARS));
    });
  }

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

  const draft = clip(input.draft.trim(), DRAFT_MAX_CHARS);
  if (draft === "") {
    return { system, userMessage: lines.join("\n") };
  }

  // 초안이 있으면 작업 자체가 달라진다. 초안을 자료 뒤에 한 구간으로 덧붙이면
  // gpt-5-mini(reasoning minimal)는 템플릿·대화 이력으로 새 답변을 쓰고 초안의
  // 결정("해결했다")을 뒤집었다(실측). 맨 앞에서 "초안 다듬기"로 작업을 정의하고
  // 초안을 자료보다 먼저 보여준 뒤, 긴 자료 뒤에서 한 번 더 상기시켜야 따라온다.
  const userMessage = [
    ...DRAFT_TASK,
    "",
    "초안:",
    draft,
    "",
    "---",
    "참고 정보 (말투와 사실 확인에만 쓰세요):",
    ...lines,
    "",
    "---",
    "다시 한 번: 위 '초안'을 다듬은 메일 본문만 출력하세요. 초안에 없는 내용을 덧붙이지 마세요.",
  ].join("\n");

  return { system, userMessage };
}

/** 초안이 있을 때 user 메시지 맨 앞에 두는 작업 정의. system은 캐시를 위해 그대로 둔다. */
const DRAFT_TASK = [
  "## 이번 작업: 초안 다듬기",
  "관리자가 아래 '초안'을 이미 썼습니다. 새 답변을 쓰는 것이 아니라 이 초안을 정중한 메일 문장으로 다듬는 것이 당신의 일입니다.",
  "- 초안에 적힌 사실·결정·방향을 그대로 유지하세요. 초안이 '해결했다'면 해결했다고, '안 된다'면 안 된다고 쓰세요.",
  "- 초안에 없는 안내·요청·절차(추가 정보 요청, 확인 중 안내, 보상 조건 등)를 덧붙이지 마세요.",
  "- 빠진 인사와 맺음말만 채우고, 길이는 초안의 3배를 넘기지 마세요.",
  "- 아래 참고 정보(문의 내용·대화 이력·템플릿·과거 답변)는 말투와 사실 확인에만 쓰세요.",
];

const CONVERSATION_LABELS: Record<ConversationEntry["kind"], string> = {
  outbound: "보낸 답변",
  auto: "자동 답변",
  inbound: "사용자 회신",
  note: "내부 메모",
};

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)} (이하 생략)` : text;
}

const promptTimeFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "2026-09-02 09:10" (Asia/Seoul). 모델이 순서와 간격을 읽을 수 있을 만큼만 적는다. */
function formatPromptTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return promptTimeFormatter.format(date);
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
