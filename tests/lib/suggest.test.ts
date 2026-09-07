import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSuggestPrompt, streamSuggestion, type SuggestEvent, type SuggestInput } from "@/lib/suggest";
import { EVIDENCE_DELIMITER } from "@/lib/suggest-evidence";

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn(function () {
    return { chat: { completions: { create: createMock } } };
  }),
}));

function makeInput(overrides: Partial<SuggestInput> = {}): SuggestInput {
  return {
    gameName: "여신키우기",
    groupLabel: "게임 이용 문의",
    typeLabel: "결제/환불",
    title: "결제했는데 재화가 안 들어와요",
    content: "어제 30000원 결제했는데 다이아가 지급되지 않았습니다.",
    gameAccount: "player#1234",
    companyName: null,
    templates: [],
    pastReplies: [],
    sourcesText: "",
    ...overrides,
  };
}

describe("buildSuggestPrompt", () => {
  it("states the core rules in the system prompt", () => {
    const { system } = buildSuggestPrompt(makeInput());
    expect(system).toContain("한국어");
    expect(system).toContain("지어내지");
    expect(system).toContain("확인 후 안내드리겠습니다");
    expect(system).toContain("서명");
    // 템플릿 제목을 본문에 복사하는 실제 사례가 있었다.
    expect(system).toContain("제목");
  });

  it("tells the model to use facts from the sources and to end with an evidence section", () => {
    const { system } = buildSuggestPrompt(makeInput());
    expect(system).toContain("참고 자료에 있는 사실");
    expect(system).toContain(EVIDENCE_DELIMITER);
    expect(system).toContain("없음");
    // 과거 답변의 계정·금액·날짜를 옮겨 적으면 안 된다.
    expect(system).toContain("옮겨 적지");
  });

  it("appends the sources after the rules so the stable prefix caches", () => {
    const { system } = buildSuggestPrompt(makeInput({ sourcesText: "# 시트: VIP 원장\n\n## VIP\n이메일 | VIP 단계" }));
    const rulesEnd = system.indexOf("# 참고 자료");
    expect(rulesEnd).toBeGreaterThan(0);
    expect(system.slice(rulesEnd)).toContain("VIP 원장");
    expect(system.indexOf("지어내지")).toBeLessThan(rulesEnd);
  });

  it("omits the sources section when there are none", () => {
    expect(buildSuggestPrompt(makeInput()).system).not.toContain("# 참고 자료");
  });

  it("includes the game, category, title, and body", () => {
    const { userMessage } = buildSuggestPrompt(makeInput());
    expect(userMessage).toContain("여신키우기");
    expect(userMessage).toContain("게임 이용 문의");
    expect(userMessage).toContain("결제/환불");
    expect(userMessage).toContain("결제했는데 재화가 안 들어와요");
    expect(userMessage).toContain("다이아가 지급되지 않았습니다");
  });

  it("includes the game account when present and omits the line when not", () => {
    expect(buildSuggestPrompt(makeInput()).userMessage).toContain("player#1234");
    const withoutAccount = buildSuggestPrompt(makeInput({ gameAccount: null })).userMessage;
    expect(withoutAccount).not.toContain("게임 계정");
  });

  it("includes the company name only when present", () => {
    const withCompany = buildSuggestPrompt(makeInput({ companyName: "플레이컴퍼니" })).userMessage;
    expect(withCompany).toContain("플레이컴퍼니");
    expect(buildSuggestPrompt(makeInput()).userMessage).not.toContain("회사명");
  });

  it("includes templates when given", () => {
    const { userMessage } = buildSuggestPrompt(
      makeInput({ templates: [{ title: "환불 안내", content: "환불 절차는 다음과 같습니다." }] })
    );
    expect(userMessage).toContain("참고 템플릿");
    expect(userMessage).toContain("환불 안내");
    expect(userMessage).toContain("환불 절차는 다음과 같습니다.");
    // 제목을 대괄호로 감싸면 모델이 본문 머리말로 오해해 그대로 복사한다.
    expect(userMessage).not.toContain("[환불 안내]");
  });

  it("omits the template section entirely when there are none", () => {
    expect(buildSuggestPrompt(makeInput()).userMessage).not.toContain("참고 템플릿");
  });

  it("lists similar past inquiries with their number, summary, and reply", () => {
    const { userMessage } = buildSuggestPrompt(
      makeInput({
        pastReplies: [
          { inquiryNo: "R-20260902-0001", title: "결제 두 번 됨", excerpt: "카드가 두 번 긁혔어요", reply: "중복 결제분은 환불했습니다." },
        ],
      })
    );
    expect(userMessage).toContain("과거 문의와 답변");
    expect(userMessage).toContain("1) 문의 R-20260902-0001: 결제 두 번 됨");
    expect(userMessage).toContain("문의 요약: 카드가 두 번 긁혔어요");
    expect(userMessage).toContain("보낸 답변:");
    expect(userMessage).toContain("중복 결제분은 환불했습니다.");
  });

  it("labels fallback entries as recent replies of the same type without a summary", () => {
    const { userMessage } = buildSuggestPrompt(
      makeInput({ pastReplies: [{ inquiryNo: null, title: null, excerpt: null, reply: "확인 후 지급해드렸습니다." }] })
    );
    expect(userMessage).toContain("1) 같은 유형의 최근 답변:");
    expect(userMessage).toContain("확인 후 지급해드렸습니다.");
    expect(userMessage).not.toContain("문의 요약");
  });

  it("omits the past-reply section entirely when there are none", () => {
    expect(buildSuggestPrompt(makeInput()).userMessage).not.toContain("과거 문의와 답변");
  });
});

/** OpenAI 스트림 chunk를 흉내 낸다. */
function chunks(items: Array<{ text?: string; finishReason?: string | null }>) {
  return (async function* () {
    for (const item of items) {
      yield { choices: [{ delta: { content: item.text }, finish_reason: item.finishReason ?? null }] };
    }
  })();
}

async function collect(input: SuggestInput): Promise<SuggestEvent[]> {
  const events: SuggestEvent[] = [];
  for await (const event of streamSuggestion(input)) events.push(event);
  return events;
}

describe("streamSuggestion", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;

  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.OPENAI_MODEL;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
  });

  it("reports not_configured without calling the SDK when the key is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(collect(makeInput())).resolves.toEqual([{ type: "error", reason: "not_configured" }]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("yields each text chunk as it arrives", async () => {
    createMock.mockResolvedValue(chunks([{ text: "안녕하세요, " }, { text: "확인 후 " }, { text: "안내드리겠습니다." }]));

    await expect(collect(makeInput())).resolves.toEqual([
      { type: "text", text: "안녕하세요, " },
      { type: "text", text: "확인 후 " },
      { type: "text", text: "안내드리겠습니다." },
    ]);
  });

  it("skips chunks that carry no text", async () => {
    createMock.mockResolvedValue(chunks([{ text: "" }, { text: undefined }, { text: "본문" }]));

    await expect(collect(makeInput())).resolves.toEqual([{ type: "text", text: "본문" }]);
  });

  it("defaults to gpt-5-mini and honours OPENAI_MODEL", async () => {
    createMock.mockImplementation(async () => chunks([{ text: "본문" }]));

    await collect(makeInput());
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5-mini" }));

    process.env.OPENAI_MODEL = "gpt-5-something";
    await collect(makeInput());
    expect(createMock).toHaveBeenLastCalledWith(expect.objectContaining({ model: "gpt-5-something" }));
  });

  it("streams with minimal reasoning, no temperature, and the system prompt first", async () => {
    createMock.mockResolvedValue(chunks([{ text: "본문" }]));

    await collect(makeInput());

    const call = createMock.mock.calls[0][0];
    expect(call.stream).toBe(true);
    expect(call.reasoning_effort).toBe("minimal");
    expect(call.max_completion_tokens).toBe(2048);
    // gpt-5 계열은 기본값 외의 temperature를 거절한다.
    expect(call).not.toHaveProperty("temperature");
    expect(call.messages[0]).toEqual({ role: "system", content: expect.stringContaining("지어내지") });
    expect(call.messages[1]).toEqual({ role: "user", content: expect.stringContaining("다이아가 지급되지 않았습니다") });
  });

  it("reports refused when the content filter stops generation mid-stream", async () => {
    createMock.mockResolvedValue(chunks([{ text: "일부 " }, { text: "", finishReason: "content_filter" }]));

    await expect(collect(makeInput())).resolves.toEqual([
      { type: "text", text: "일부 " },
      { type: "error", reason: "refused" },
    ]);
  });

  it("reports refused when the stream ends without any text", async () => {
    createMock.mockResolvedValue(chunks([{ text: undefined, finishReason: "stop" }]));

    await expect(collect(makeInput())).resolves.toEqual([{ type: "error", reason: "refused" }]);
  });

  it("reports failed when the SDK throws before streaming", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMock.mockRejectedValue(new Error("network down"));

    await expect(collect(makeInput())).resolves.toEqual([{ type: "error", reason: "failed" }]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("reports failed when the stream breaks after some text", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMock.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: "앞부분" }, finish_reason: null }] };
        throw new Error("connection reset");
      })()
    );

    await expect(collect(makeInput())).resolves.toEqual([
      { type: "text", text: "앞부분" },
      { type: "error", reason: "failed" },
    ]);
    warnSpy.mockRestore();
  });
});
