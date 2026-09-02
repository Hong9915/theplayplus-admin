import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSuggestPrompt, requestSuggestion, type SuggestInput } from "@/lib/suggest";

const generateContentMock = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => ({ models: { generateContent: generateContentMock } })),
  // 실제 모듈이 export하는 enum. 빠뜨리면 ThinkingLevel.MINIMAL이 undefined를
  // 참조해 호출이 통째로 throw되고, 그게 "failed"로 뭉개져 보인다.
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
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

  it("includes past replies when given", () => {
    const { userMessage } = buildSuggestPrompt(makeInput({ pastReplies: ["확인 후 지급해드렸습니다."] }));
    expect(userMessage).toContain("과거 답변");
    expect(userMessage).toContain("확인 후 지급해드렸습니다.");
  });

  it("omits the past-reply section entirely when there are none", () => {
    expect(buildSuggestPrompt(makeInput()).userMessage).not.toContain("과거 답변");
  });
});

describe("requestSuggestion", () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;

  beforeEach(() => {
    generateContentMock.mockReset();
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
  });

  it("reports not_configured without calling the SDK when the key is missing", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(requestSuggestion(makeInput())).resolves.toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("returns the trimmed suggestion text on success", async () => {
    generateContentMock.mockResolvedValue({
      text: "  안녕하세요, 확인 후 안내드리겠습니다.  ",
      candidates: [{ finishReason: "STOP" }],
    });

    await expect(requestSuggestion(makeInput())).resolves.toEqual({
      ok: true,
      text: "안녕하세요, 확인 후 안내드리겠습니다.",
    });
  });

  it("defaults to gemini-3.5-flash-lite and honours GEMINI_MODEL", async () => {
    generateContentMock.mockResolvedValue({ text: "본문", candidates: [{ finishReason: "STOP" }] });

    await requestSuggestion(makeInput());
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-3.5-flash-lite" })
    );

    process.env.GEMINI_MODEL = "gemini-3-something";
    await requestSuggestion(makeInput());
    expect(generateContentMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: "gemini-3-something" })
    );
  });

  it("keeps thinking minimal and passes the system instruction", async () => {
    generateContentMock.mockResolvedValue({ text: "본문", candidates: [{ finishReason: "STOP" }] });

    await requestSuggestion(makeInput());

    const call = generateContentMock.mock.calls[0][0];
    // thinkingBudget: 0은 gemini-3.5-flash-lite에서 400 INVALID_ARGUMENT다.
    // 이 모델은 thinkingLevel로만 사고량을 조절한다.
    expect(call.config.thinkingConfig).toEqual({ thinkingLevel: "MINIMAL" });
    expect(call.config.systemInstruction).toContain("지어내지");
  });

  it("reports refused when the safety filter stops generation", async () => {
    generateContentMock.mockResolvedValue({ text: "", candidates: [{ finishReason: "SAFETY" }] });

    await expect(requestSuggestion(makeInput())).resolves.toEqual({ ok: false, reason: "refused" });
  });

  it("reports refused on RECITATION", async () => {
    generateContentMock.mockResolvedValue({ text: "일부", candidates: [{ finishReason: "RECITATION" }] });

    await expect(requestSuggestion(makeInput())).resolves.toEqual({ ok: false, reason: "refused" });
  });

  it("reports refused when the response carries no text", async () => {
    generateContentMock.mockResolvedValue({ text: undefined, candidates: [{ finishReason: "STOP" }] });

    await expect(requestSuggestion(makeInput())).resolves.toEqual({ ok: false, reason: "refused" });
  });

  it("reports failed when the SDK throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateContentMock.mockRejectedValue(new Error("network down"));

    await expect(requestSuggestion(makeInput())).resolves.toEqual({ ok: false, reason: "failed" });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
