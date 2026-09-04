import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/suggest/route";
import * as supabaseModule from "@/lib/supabase";
import * as inquiriesModule from "@/lib/inquiries";
import * as categoriesModule from "@/lib/categories";
import * as templatesModule from "@/lib/templates";
import * as repliesModule from "@/lib/replies";
import * as suggestModule from "@/lib/suggest";
import * as sessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/inquiries", () => ({ getInquiryById: vi.fn() }));
vi.mock("@/lib/categories", () => ({ listCategoryLabels: vi.fn(), listGames: vi.fn() }));
vi.mock("@/lib/templates", () => ({ listTemplates: vi.fn() }));
vi.mock("@/lib/replies", () => ({ listRecentRepliesByType: vi.fn() }));
vi.mock("@/lib/suggest", () => ({ streamSuggestion: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));

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
  locale: null,
  paymentNo: null,
  occurredAt: null,
  deviceInfo: null,
  createdAt: "2026-09-02T00:00:00.000Z",
};

function suggestRequest() {
  return new Request("http://localhost/api/inquiries/inq-1/suggest", { method: "POST" });
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
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset().mockReturnValue({} as never);
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(inquiriesModule.getInquiryById).mockReset().mockResolvedValue(inquiry);
    vi.mocked(categoriesModule.listCategoryLabels).mockReset().mockResolvedValue({
      groupLabels: { game_usage: "게임 이용 문의" },
      typeLabels: { payment_refund: "결제/환불" },
      typeOrder: ["payment_refund"],
    });
    vi.mocked(categoriesModule.listGames).mockReset().mockResolvedValue([
      { id: "game-1", name: "여신키우기", status: "active", logoPath: null, ownerName: null, createdAt: "" },
    ]);
    vi.mocked(templatesModule.listTemplates).mockReset().mockResolvedValue([]);
    vi.mocked(repliesModule.listRecentRepliesByType).mockReset().mockResolvedValue([]);
    vi.mocked(suggestModule.streamSuggestion)
      .mockReset()
      .mockImplementation(() => events({ type: "text", text: "추천 " }, { type: "text", text: "본문" }));
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
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    await expect(readLines(response)).resolves.toEqual([
      { type: "text", text: "추천 " },
      { type: "text", text: "본문" },
    ]);
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
});
