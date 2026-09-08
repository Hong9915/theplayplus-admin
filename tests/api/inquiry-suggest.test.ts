import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/suggest/route";
import * as supabaseModule from "@/lib/supabase";
import * as inquiriesModule from "@/lib/inquiries";
import * as categoriesModule from "@/lib/categories";
import * as templatesModule from "@/lib/templates";
import * as repliesModule from "@/lib/replies";
import * as suggestModule from "@/lib/suggest";
import * as sessionModule from "@/lib/require-admin-session";
import * as sourcesModule from "@/lib/assistant-sources";
import * as embeddingsModule from "@/lib/embeddings";
import * as messagesModule from "@/lib/messages";
import * as notesModule from "@/lib/notes";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/inquiries", () => ({ getInquiryById: vi.fn() }));
vi.mock("@/lib/categories", () => ({ listCategoryLabelsForScope: vi.fn(), listGames: vi.fn() }));
vi.mock("@/lib/templates", () => ({ listTemplates: vi.fn() }));
// mergePastReplies는 순수 함수라 실제 구현을 쓴다.
vi.mock("@/lib/replies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/replies")>();
  return { ...actual, listRecentRepliesByType: vi.fn(), listSimilarAnsweredReplies: vi.fn() };
});
vi.mock("@/lib/suggest", () => ({ streamSuggestion: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));
vi.mock("@/lib/assistant-sources", () => ({ listSources: vi.fn(), loadSources: vi.fn(), serializeSources: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ ensureInquiryEmbedding: vi.fn() }));
vi.mock("@/lib/messages", () => ({ listMessages: vi.fn() }));
vi.mock("@/lib/notes", () => ({ listNotes: vi.fn() }));

const EMBEDDING = [0.1, 0.2, 0.3];
const sheetSource = { id: "src-1", gameId: "game-1", kind: "sheet" as const, externalId: "sh-1", title: "VIP 원장", createdAt: "" };
const loadedSheet = { source: sheetSource, kind: "sheet" as const, tabs: [] };

/** loadSources가 던지는 SheetError를 흉내 낸다. 실제 클래스를 import하면 googleapis가 딸려온다. */
function sourceError(sourceTitle?: string) {
  const error = new Error("source_forbidden") as Error & { reason: string; sourceTitle?: string };
  error.name = "SheetError";
  error.reason = "source_forbidden";
  if (sourceTitle) error.sourceTitle = sourceTitle;
  return error;
}

const inquiry = {
  id: "inq-1",
  inquiryNo: "R-20260902-0001",
  gameId: "game-1",
  groupKey: "game_usage",
  typeKey: "payment_refund",
  gameAccount: "player#1234",
  companyName: null,
  replyEmail: "user@example.com",
  title: "결제 오류",
  content: "다이아가 안 들어옵니다",
  status: "new" as const,
  priority: "normal" as const,
  meta: {},
  draftReply: null,
  replyContent: null,
  repliedAt: null,
  gmailThreadId: null,
  unreadReplyAt: null,
  locale: null,
  translations: {},
  paymentNo: null,
  occurredAt: null,
  deviceInfo: null,
  createdAt: "2026-09-02T00:00:00.000Z",
};

function suggestRequest(body?: unknown) {
  return new Request("http://localhost/api/inquiries/inq-1/suggest", {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

function events(...items: suggestModule.SuggestEvent[]) {
  return (async function* () {
    for (const item of items) yield item;
  })();
}

/** NDJSON 응답 본문을 한 줄씩 파싱한다. */
async function readLines(response: Response): Promise<unknown[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

describe("POST /api/inquiries/[id]/suggest", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = "test-key";
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset().mockReturnValue({} as never);
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(inquiriesModule.getInquiryById).mockReset().mockResolvedValue(inquiry);
    vi.mocked(categoriesModule.listCategoryLabelsForScope).mockReset().mockResolvedValue({
      groupLabels: { game_usage: "게임 이용 문의" },
      typeLabels: { payment_refund: "결제/환불" },
      typeOrder: ["payment_refund"],
    });
    vi.mocked(categoriesModule.listGames).mockReset().mockResolvedValue([
      { id: "game-1", name: "여신키우기", status: "active", logoPath: null, ownerName: null, createdAt: "" },
    ]);
    vi.mocked(templatesModule.listTemplates).mockReset().mockResolvedValue([]);
    vi.mocked(repliesModule.listRecentRepliesByType).mockReset().mockResolvedValue([]);
    vi.mocked(repliesModule.listSimilarAnsweredReplies).mockReset().mockResolvedValue([]);
    vi.mocked(sourcesModule.listSources).mockReset().mockResolvedValue([]);
    vi.mocked(sourcesModule.loadSources).mockReset().mockResolvedValue([]);
    vi.mocked(sourcesModule.serializeSources).mockReset().mockReturnValue("");
    vi.mocked(embeddingsModule.ensureInquiryEmbedding).mockReset().mockResolvedValue(EMBEDDING);
    vi.mocked(messagesModule.listMessages).mockReset().mockResolvedValue([]);
    vi.mocked(notesModule.listNotes).mockReset().mockResolvedValue([]);
    vi.mocked(suggestModule.streamSuggestion)
      .mockReset()
      .mockImplementation(() => events({ type: "text", text: "추천 " }, { type: "text", text: "본문" }));
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(response.status).toBe(401);
    expect(suggestModule.streamSuggestion).not.toHaveBeenCalled();
  });

  it("returns 404 when the inquiry does not exist", async () => {
    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(null);

    const response = await POST(suggestRequest(), { params: { id: "missing" } });

    expect(response.status).toBe(404);
    expect(suggestModule.streamSuggestion).not.toHaveBeenCalled();
  });

  it("short-circuits with a not_configured error and reads nothing else when the key is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    await expect(readLines(response)).resolves.toEqual([{ type: "error", reason: "not_configured" }]);
    expect(sourcesModule.listSources).not.toHaveBeenCalled();
    expect(embeddingsModule.ensureInquiryEmbedding).not.toHaveBeenCalled();
    expect(suggestModule.streamSuggestion).not.toHaveBeenCalled();
  });

  it("passes Korean labels, the game name, and the inquiry body to the suggester", async () => {
    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        gameName: "여신키우기",
        groupLabel: "게임 이용 문의",
        typeLabel: "결제/환불",
        title: "결제 오류",
        content: "다이아가 안 들어옵니다",
        gameAccount: "player#1234",
        sourcesText: "",
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    await expect(readLines(response)).resolves.toEqual([
      { type: "text", text: "추천 " },
      { type: "text", text: "본문" },
    ]);
  });

  it("passes the draft from the request body and an empty draft when the body is missing or malformed", async () => {
    await POST(suggestRequest({ draft: "확인해 보니 누락분 지급했습니다" }), { params: { id: "inq-1" } });
    expect(suggestModule.streamSuggestion).toHaveBeenLastCalledWith(
      expect.objectContaining({ draft: "확인해 보니 누락분 지급했습니다" })
    );

    await POST(suggestRequest(), { params: { id: "inq-1" } });
    expect(suggestModule.streamSuggestion).toHaveBeenLastCalledWith(expect.objectContaining({ draft: "" }));

    await POST(suggestRequest("{not json"), { params: { id: "inq-1" } });
    expect(suggestModule.streamSuggestion).toHaveBeenLastCalledWith(expect.objectContaining({ draft: "" }));

    await POST(suggestRequest({ draft: 123 }), { params: { id: "inq-1" } });
    expect(suggestModule.streamSuggestion).toHaveBeenLastCalledWith(expect.objectContaining({ draft: "" }));
  });

  it("merges this inquiry's messages and notes into one time-ordered conversation", async () => {
    vi.mocked(messagesModule.listMessages).mockResolvedValue([
      { id: "m1", direction: "outbound", authorEmail: null, body: "자동 안내", gmailMessageId: null, rfcMessageId: null, sentAt: "2026-09-02T00:10:00.000Z", autoSent: true, translations: {} },
      { id: "m2", direction: "outbound", authorEmail: "admin@x", body: "확인 중입니다", gmailMessageId: null, rfcMessageId: null, sentAt: "2026-09-02T01:00:00.000Z", autoSent: false, translations: {} },
      { id: "m3", direction: "inbound", authorEmail: "user@x", body: "아직도 안 돼요", gmailMessageId: "g3", rfcMessageId: null, sentAt: "2026-09-03T00:00:00.000Z", autoSent: false, translations: {} },
    ]);
    vi.mocked(notesModule.listNotes).mockResolvedValue([
      { id: "n1", authorEmail: "admin@x", content: "PG 확인 요청함", createdAt: "2026-09-02T02:00:00.000Z" },
    ]);

    await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(messagesModule.listMessages).toHaveBeenCalledWith(expect.anything(), "inq-1");
    expect(notesModule.listNotes).toHaveBeenCalledWith(expect.anything(), "inq-1");
    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: [
          { kind: "auto", at: "2026-09-02T00:10:00.000Z", body: "자동 안내" },
          { kind: "outbound", at: "2026-09-02T01:00:00.000Z", body: "확인 중입니다" },
          { kind: "note", at: "2026-09-02T02:00:00.000Z", body: "PG 확인 요청함" },
          { kind: "inbound", at: "2026-09-03T00:00:00.000Z", body: "아직도 안 돼요" },
        ],
      })
    );
  });

  it("still suggests with an empty conversation when messages or notes cannot be read", async () => {
    vi.mocked(messagesModule.listMessages).mockRejectedValue(new Error("db down"));

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(expect.objectContaining({ conversation: [] }));
  });

  it("only forwards templates for this type or shared ones", async () => {
    vi.mocked(templatesModule.listTemplates).mockResolvedValue([
      { id: "t1", typeKey: "payment_refund", title: "환불", content: "환불 본문", autoSend: false },
      { id: "t2", typeKey: null, title: "공용", content: "공용 본문", autoSend: false },
      { id: "t3", typeKey: "bug_report", title: "버그", content: "버그 본문", autoSend: false },
    ]);

    await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        templates: [
          { title: "환불", content: "환불 본문" },
          { title: "공용", content: "공용 본문" },
        ],
      })
    );
  });

  it("forwards error events as NDJSON so the UI can tell the admin what to fix", async () => {
    vi.mocked(suggestModule.streamSuggestion).mockImplementation(() =>
      events({ type: "error", reason: "not_configured" })
    );

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    await expect(readLines(response)).resolves.toEqual([{ type: "error", reason: "not_configured" }]);
  });

  it("forwards a mid-stream refusal after the text that came before it", async () => {
    vi.mocked(suggestModule.streamSuggestion).mockImplementation(() =>
      events({ type: "text", text: "일부" }, { type: "error", reason: "refused" })
    );

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    await expect(readLines(response)).resolves.toEqual([
      { type: "text", text: "일부" },
      { type: "error", reason: "refused" },
    ]);
  });

  it("suggests for a service inquiry without a game: no templates, blank game name, service scope lookups", async () => {
    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue({
      ...inquiry,
      gameId: null,
      gameAccount: null,
      companyName: "플레이컴퍼니",
      groupKey: "business",
      typeKey: "publishing",
    } as never);
    vi.mocked(categoriesModule.listCategoryLabelsForScope).mockResolvedValue({
      groupLabels: { business: "사업 제휴 문의" },
      typeLabels: { publishing: "퍼블리싱 제휴" },
      typeOrder: ["publishing"],
    });

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    expect(templatesModule.listTemplates).not.toHaveBeenCalled();
    expect(categoriesModule.listCategoryLabelsForScope).toHaveBeenCalledWith(expect.anything(), { kind: "service" });
    expect(sourcesModule.listSources).not.toHaveBeenCalled();
    expect(repliesModule.listSimilarAnsweredReplies).toHaveBeenCalledWith(expect.anything(), { kind: "service" }, EMBEDDING, "inq-1");
    expect(repliesModule.listRecentRepliesByType).toHaveBeenCalledWith(expect.anything(), { kind: "service" }, "publishing");
    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        gameName: "",
        groupLabel: "사업 제휴 문의",
        typeLabel: "퍼블리싱 제휴",
        companyName: "플레이컴퍼니",
        templates: [],
        sourcesText: "",
      })
    );
  });

  it("loads the game's sources and passes the serialized text", async () => {
    vi.mocked(sourcesModule.listSources).mockResolvedValue([sheetSource]);
    vi.mocked(sourcesModule.loadSources).mockResolvedValue([loadedSheet]);
    vi.mocked(sourcesModule.serializeSources).mockReturnValue("# 시트: VIP 원장\n\n## VIP\n…");

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(sourcesModule.listSources).toHaveBeenCalledWith(expect.anything(), "game-1");
    expect(sourcesModule.loadSources).toHaveBeenCalledWith([sheetSource]);
    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ sourcesText: "# 시트: VIP 원장\n\n## VIP\n…" })
    );
    await expect(readLines(response)).resolves.toEqual([
      { type: "text", text: "추천 " },
      { type: "text", text: "본문" },
    ]);
  });

  it("does not read sources at all when none are registered", async () => {
    await POST(suggestRequest(), { params: { id: "inq-1" } });
    expect(sourcesModule.loadSources).not.toHaveBeenCalled();
  });

  it("warns and continues without sources when loading them fails, naming the source", async () => {
    vi.mocked(sourcesModule.listSources).mockResolvedValue([sheetSource]);
    vi.mocked(sourcesModule.loadSources).mockRejectedValue(sourceError("VIP 원장"));

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(expect.objectContaining({ sourcesText: "" }));
    await expect(readLines(response)).resolves.toEqual([
      { type: "warning", reason: "sources_unavailable", sourceTitle: "VIP 원장" },
      { type: "text", text: "추천 " },
      { type: "text", text: "본문" },
    ]);
  });

  it("omits sourceTitle from the warning when the failure has none", async () => {
    vi.mocked(sourcesModule.listSources).mockResolvedValue([sheetSource]);
    vi.mocked(sourcesModule.loadSources).mockRejectedValue(new Error("boom"));

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    const lines = await readLines(response);
    expect(lines[0]).toEqual({ type: "warning", reason: "sources_unavailable" });
  });

  it("passes similar replies through and skips the recent-reply fallback when there are two or more", async () => {
    const similar = [
      { inquiryNo: "R-1", title: "a", excerpt: "x", reply: "A" },
      { inquiryNo: "R-2", title: "b", excerpt: "y", reply: "B" },
    ];
    vi.mocked(repliesModule.listSimilarAnsweredReplies).mockResolvedValue(similar);

    await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(embeddingsModule.ensureInquiryEmbedding).toHaveBeenCalledWith(expect.anything(), inquiry);
    expect(repliesModule.listSimilarAnsweredReplies).toHaveBeenCalledWith(expect.anything(), { kind: "game", gameId: "game-1" }, EMBEDDING, "inq-1");
    expect(repliesModule.listRecentRepliesByType).not.toHaveBeenCalled();
    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(expect.objectContaining({ pastReplies: similar }));
  });

  it("tops up with recent replies of the same type when fewer than two similar ones exist", async () => {
    vi.mocked(repliesModule.listSimilarAnsweredReplies).mockResolvedValue([
      { inquiryNo: "R-1", title: "a", excerpt: "x", reply: "A" },
    ]);
    vi.mocked(repliesModule.listRecentRepliesByType).mockResolvedValue(["A", "C"]);

    await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(repliesModule.listRecentRepliesByType).toHaveBeenCalledWith(expect.anything(), { kind: "game", gameId: "game-1" }, "payment_refund");
    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        pastReplies: [
          { inquiryNo: "R-1", title: "a", excerpt: "x", reply: "A" },
          { inquiryNo: null, title: null, excerpt: null, reply: "C" },
        ],
      })
    );
  });

  it("warns and uses only recent replies when the embedding could not be made", async () => {
    vi.mocked(embeddingsModule.ensureInquiryEmbedding).mockResolvedValue(null);
    vi.mocked(repliesModule.listRecentRepliesByType).mockResolvedValue(["최근 답변"]);

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    expect(repliesModule.listSimilarAnsweredReplies).not.toHaveBeenCalled();
    expect(suggestModule.streamSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ pastReplies: [{ inquiryNo: null, title: null, excerpt: null, reply: "최근 답변" }] })
    );
    const lines = await readLines(response);
    expect(lines[0]).toEqual({ type: "warning", reason: "similar_unavailable" });
  });

  it("sends the sources warning before the similar-replies warning, both before any text", async () => {
    vi.mocked(sourcesModule.listSources).mockResolvedValue([sheetSource]);
    vi.mocked(sourcesModule.loadSources).mockRejectedValue(sourceError());
    vi.mocked(embeddingsModule.ensureInquiryEmbedding).mockResolvedValue(null);

    const response = await POST(suggestRequest(), { params: { id: "inq-1" } });

    await expect(readLines(response)).resolves.toEqual([
      { type: "warning", reason: "sources_unavailable" },
      { type: "warning", reason: "similar_unavailable" },
      { type: "text", text: "추천 " },
      { type: "text", text: "본문" },
    ]);
  });
});
