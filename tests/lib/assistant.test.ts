import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildAssistantPrompt,
  describeProposal,
  historyToMessages,
  formatToday,
  streamAssistant,
  type AssistantEvent,
  type HistoryMessage,
} from "@/lib/assistant";
import type { SheetTab } from "@/lib/sheets";

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn(function () {
    return { chat: { completions: { create: createMock } } };
  }),
}));

const vip: SheetTab = {
  title: "VIP",
  header: ["이메일", "VIP 단계"],
  rows: [["이메일", "VIP 단계"], ["a@x.com", "VIP3"]],
};

async function collect(events: AsyncGenerator<AssistantEvent>) {
  const out: AssistantEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function chunks(...deltas: Array<Record<string, unknown>>) {
  return (async function* () {
    for (const delta of deltas) yield { choices: [{ delta }] };
  })();
}

describe("formatToday", () => {
  it("formats as MM.DD", () => {
    expect(formatToday(new Date(2026, 8, 4))).toBe("09.04");
  });
});

describe("buildAssistantPrompt", () => {
  it("includes the rules, game, date, and sheet text", () => {
    const system = buildAssistantPrompt({ gameName: "여신 키우기", today: "09.04", sheetText: "## VIP\n행 | 이메일" });
    expect(system).toContain("여신 키우기");
    expect(system).toContain("09.04");
    expect(system).toContain("한국어");
    expect(system).toContain("propose_update");
    expect(system).toContain("propose_append");
    expect(system).toContain("찾지 못했습니다");
    expect(system).toContain("되묻");
    expect(system).toContain("# 시트 내용");
    expect(system).toContain("## VIP");
  });
});

describe("describeProposal", () => {
  it("summarizes an update with its status", () => {
    const text = describeProposal(
      { kind: "update", sheet: "VIP", row: 7, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] },
      "applied"
    );
    expect(text).toBe("시트 수정 제안: VIP 탭 7행 VIP 단계 'VIP3' → 'VIP4' (적용됨)");
  });
  it("summarizes an append and other statuses", () => {
    const proposal = { kind: "append" as const, sheet: "VIP", values: { 이메일: "c@x.com", "VIP 단계": "VIP1" } };
    expect(describeProposal(proposal, "pending")).toBe("시트 수정 제안: VIP 탭에 행 추가 이메일 'c@x.com', VIP 단계 'VIP1' (대기)");
    expect(describeProposal(proposal, "cancelled")).toContain("(취소됨)");
    expect(describeProposal(proposal, "failed")).toContain("(실패)");
    expect(describeProposal(proposal, null)).toContain("(대기)");
  });
});

describe("historyToMessages", () => {
  it("keeps user/assistant text and turns proposals into assistant summaries", () => {
    const history: HistoryMessage[] = [
      { role: "user", content: "VIP 올려줘", proposal: null, status: null },
      { role: "proposal", content: "", proposal: { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] }, status: "applied" },
      { role: "assistant", content: "네", proposal: null, status: null },
    ];
    expect(historyToMessages(history)).toEqual([
      { role: "user", content: "VIP 올려줘" },
      { role: "assistant", content: "시트 수정 제안: VIP 탭 2행 VIP 단계 'VIP3' → 'VIP4' (적용됨)" },
      { role: "assistant", content: "네" },
    ]);
  });
});

describe("streamAssistant", () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.OPENAI_MODEL;
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  const history: HistoryMessage[] = [{ role: "user", content: "질문", proposal: null, status: null }];

  it("yields not_configured without an api key", async () => {
    delete process.env.OPENAI_API_KEY;
    const events = await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(events).toEqual([{ type: "error", reason: "not_configured" }]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("streams text deltas and sends system + history + tools", async () => {
    createMock.mockResolvedValue(chunks({ content: "안녕" }, { content: "하세요" }));
    const events = await collect(streamAssistant({ system: "SYS", history, tabs: [vip] }));
    expect(events).toEqual([
      { type: "text", text: "안녕" },
      { type: "text", text: "하세요" },
    ]);
    const args = createMock.mock.calls[0][0];
    expect(args.model).toBe("gpt-5-mini");
    expect(args.stream).toBe(true);
    expect(args.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(args.messages[1]).toEqual({ role: "user", content: "질문" });
    expect(args.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(["propose_update", "propose_append"]);
  });

  it("uses OPENAI_MODEL when set", async () => {
    process.env.OPENAI_MODEL = "gpt-5";
    createMock.mockResolvedValue(chunks({ content: "x" }));
    await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(createMock.mock.calls[0][0].model).toBe("gpt-5");
  });

  it("assembles tool call deltas into a validated proposal", async () => {
    createMock.mockResolvedValue(
      chunks(
        { tool_calls: [{ index: 0, function: { name: "propose_update", arguments: '{"sheet":"VIP","row":2,' } }] },
        { tool_calls: [{ index: 0, function: { arguments: '"updates":[{"column":"VIP 단계","before":"VIP3","after":"VIP4"}]}' } }] }
      )
    );
    const events = await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(events).toEqual([
      { type: "proposal", proposal: { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] } },
    ]);
  });

  it("maps propose_append to an append proposal", async () => {
    createMock.mockResolvedValue(
      chunks({ tool_calls: [{ index: 0, function: { name: "propose_append", arguments: '{"sheet":"VIP","values":{"이메일":"c@x.com"}}' } }] })
    );
    const events = await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(events).toEqual([{ type: "proposal", proposal: { kind: "append", sheet: "VIP", values: { 이메일: "c@x.com" } } }]);
  });

  it("yields invalid_proposal for bad tool output", async () => {
    createMock.mockResolvedValue(
      chunks({ tool_calls: [{ index: 0, function: { name: "propose_update", arguments: '{"sheet":"없음","row":2,"updates":[]}' } }] })
    );
    const events = await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(events).toEqual([{ type: "error", reason: "invalid_proposal" }]);
  });

  it("yields invalid_proposal for unparsable arguments", async () => {
    createMock.mockResolvedValue(chunks({ tool_calls: [{ index: 0, function: { name: "propose_update", arguments: "{oops" } }] }));
    const events = await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(events).toEqual([{ type: "error", reason: "invalid_proposal" }]);
  });

  it("yields model_failed when the request throws, keeping earlier text", async () => {
    createMock.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "일부" } }] };
        throw new Error("network");
      })()
    );
    const events = await collect(streamAssistant({ system: "s", history, tabs: [vip] }));
    expect(events).toEqual([
      { type: "text", text: "일부" },
      { type: "error", reason: "model_failed" },
    ]);
  });
});
