/**
 * 운영 시트 어시스턴트의 모델 호출.
 *
 * 프롬프트 조립·이력 변환은 순수 함수로 두고, OpenAI 스트림은 AssistantEvent로
 * 바꿔 내보낸다. 도구 호출은 조각을 모아 스트림이 끝난 뒤 검증한다.
 */
import OpenAI from "openai";
import { prepareProposal, type Proposal, type SheetErrorReason, type SheetTab } from "@/lib/sheets";

export type AssistantErrorReason = SheetErrorReason | "model_failed";

export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "proposal"; proposal: Proposal }
  | { type: "error"; reason: AssistantErrorReason };

export type ProposalStatus = "pending" | "applied" | "cancelled" | "failed";

export interface HistoryMessage {
  role: "user" | "assistant" | "proposal";
  content: string;
  proposal: Proposal | null;
  status: ProposalStatus | null;
  /** 사용자 메시지에 딸린 파일 이름. 어느 메시지가 어떤 파일을 가져왔는지 모델에 알린다. */
  attachmentNames?: string[];
}

/** 모델에 넘기는 이력 길이. 시트가 프롬프트 대부분을 차지하므로 이력은 짧게. */
export const HISTORY_LIMIT = 20;

const DEFAULT_MODEL = "gpt-5-mini";

/** 시트의 날짜 열 관습("08.27")에 맞춘다. 서버가 Vercel(UTC)에서 돌아도 KST 기준 날짜를 쓴다. */
export function formatToday(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const mm = parts.find((part) => part.type === "month")?.value ?? "01";
  const dd = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${mm}.${dd}`;
}

export function buildAssistantPrompt(input: { gameName: string; today: string; sheetText: string; attachmentsText?: string }): string {
  const attachmentsText = input.attachmentsText?.trim() ?? "";
  return [
    `당신은 게임 "${input.gameName}"의 운영 담당자를 돕는 어시스턴트입니다.`,
    "아래 시트 내용만 근거로 한국어로 답하세요.",
    "",
    "규칙:",
    '- 답할 때 근거가 된 탭과 행 번호를 짧게 덧붙이세요. 예: "VIP 탭 7행".',
    '- 시트에 없는 내용은 "시트에서 찾지 못했습니다"라고 말하고 추측하지 마세요.',
    "- 사용자가 시트를 바꾸자고 하면 본문으로 설명하지 말고 propose_update 또는 propose_append 도구를 부르세요.",
    "  row와 before는 표에서 본 값을 그대로 넣으세요. 첫 줄이 열 이름인 탭에서만 수정할 수 있습니다.",
    `- 갱신일·날짜 같은 열이 있으면 오늘 날짜(${input.today})도 함께 넣으세요.`,
    "- 대상 행이 여럿이거나 특정할 수 없으면 도구를 부르지 말고 어느 것인지 되묻으세요.",
    "- 표의 행 번호는 시트의 실제 행 번호입니다(1행이 열 이름).",
    ...(attachmentsText
      ? [
          "- 사용자가 대화에 올린 첨부 파일도 근거로 쓰세요. 파일 이름을 밝히되, 파일은 수정할 수 없으니 파일 내용을 바꾸자는 요청에는 도구를 부르지 마세요.",
        ]
      : []),
    "",
    `오늘 날짜: ${input.today}`,
    "",
    "# 시트 내용",
    "",
    input.sheetText,
    ...(attachmentsText ? ["", "# 첨부 파일", "", attachmentsText] : []),
  ].join("\n");
}

const STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: "대기",
  applied: "적용됨",
  cancelled: "취소됨",
  failed: "실패",
};

/** 제안을 한 줄 텍스트로. 화면 요약과 모델 이력 양쪽에서 쓴다. */
export function describeProposal(proposal: Proposal, status: ProposalStatus | null): string {
  const suffix = ` (${STATUS_LABELS[status ?? "pending"]})`;
  if (proposal.kind === "update") {
    const changes = proposal.updates.map((update) => `${update.column} '${update.before}' → '${update.after}'`).join(", ");
    return `시트 수정 제안: ${proposal.sheet} 탭 ${proposal.row}행 ${changes}${suffix}`;
  }
  const values = Object.entries(proposal.values)
    .map(([column, value]) => `${column} '${value}'`)
    .join(", ");
  return `시트 수정 제안: ${proposal.sheet} 탭에 행 추가 ${values}${suffix}`;
}

export function historyToMessages(history: HistoryMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  return history.map((message) => {
    if (message.role === "proposal" && message.proposal) {
      return { role: "assistant" as const, content: describeProposal(message.proposal, message.status) };
    }
    if (message.role === "user" && message.attachmentNames?.length) {
      const tag = `[첨부: ${message.attachmentNames.join(", ")}]`;
      return { role: "user" as const, content: message.content ? `${message.content}\n${tag}` : tag };
    }
    return { role: message.role === "user" ? ("user" as const) : ("assistant" as const), content: message.content };
  });
}

const PROPOSAL_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "propose_update",
      description: "시트의 한 행에서 몇 개 열의 값을 바꾸자고 제안한다. 관리자가 확인한 뒤에만 적용된다.",
      parameters: {
        type: "object",
        properties: {
          sheet: { type: "string", description: "탭 이름" },
          row: { type: "integer", description: "표에 적힌 행 번호(1행은 열 이름)" },
          updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                column: { type: "string", description: "열 이름" },
                before: { type: "string", description: "표에서 본 현재 값" },
                after: { type: "string", description: "바꿀 값" },
              },
              required: ["column", "before", "after"],
            },
          },
        },
        required: ["sheet", "row", "updates"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_append",
      description: "시트 탭 끝에 한 행을 추가하자고 제안한다. 관리자가 확인한 뒤에만 적용된다.",
      parameters: {
        type: "object",
        properties: {
          sheet: { type: "string", description: "탭 이름" },
          values: { type: "object", description: "열 이름 → 값", additionalProperties: { type: "string" } },
        },
        required: ["sheet", "values"],
      },
    },
  },
];

function toolCallToRaw(name: string, args: string): unknown | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if (name === "propose_update") return { kind: "update", ...(parsed as object) };
  if (name === "propose_append") return { kind: "append", ...(parsed as object) };
  return null;
}

export async function* streamAssistant(input: {
  system: string;
  history: HistoryMessage[];
  tabs: SheetTab[];
}): AsyncGenerator<AssistantEvent> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    yield { type: "error", reason: "not_configured" };
    return;
  }

  const client = new OpenAI({ apiKey });
  // tool call은 index별로 이름과 인자 조각이 따로 온다. 끝까지 모아야 파싱된다.
  const toolCalls = new Map<number, { name: string; args: string }>();

  try {
    const stream = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
      stream: true,
      messages: [{ role: "system", content: input.system }, ...historyToMessages(input.history)],
      tools: PROPOSAL_TOOLS,
      tool_choice: "auto",
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        yield { type: "text", text: delta.content };
      }
      for (const call of delta.tool_calls ?? []) {
        const slot = toolCalls.get(call.index) ?? { name: "", args: "" };
        if (call.function?.name) slot.name = call.function.name;
        if (call.function?.arguments) slot.args += call.function.arguments;
        toolCalls.set(call.index, slot);
      }
    }
  } catch (error) {
    console.warn("[assistant] OpenAI request failed", error);
    yield { type: "error", reason: "model_failed" };
    return;
  }

  for (const call of toolCalls.values()) {
    const raw = toolCallToRaw(call.name, call.args);
    const proposal = raw ? prepareProposal(input.tabs, raw) : null;
    if (!proposal) {
      yield { type: "error", reason: "invalid_proposal" };
      return;
    }
    yield { type: "proposal", proposal };
  }
}
