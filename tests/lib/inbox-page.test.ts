import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadInboxPage } from "@/lib/inbox-page";
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";
import * as inquiriesModule from "@/lib/inquiries";
import * as categoriesModule from "@/lib/categories";
import * as historyModule from "@/lib/account-history";
import * as notesModule from "@/lib/notes";
import * as eventsModule from "@/lib/events";
import * as templatesModule from "@/lib/templates";
import * as messagesModule from "@/lib/messages";

vi.mock("@/lib/inquiries", () => ({
  getInquiryById: vi.fn(),
  getInquiryFacetCounts: vi.fn(),
  listAttachmentSignedUrlsByInquiryIds: vi.fn(),
  listInquiryIds: vi.fn(),
  queryInquiries: vi.fn(),
}));
vi.mock("@/lib/categories", () => ({ listCategoryLabelsForScope: vi.fn(), listGames: vi.fn() }));
vi.mock("@/lib/account-history", () => ({ getAccountHistory: vi.fn() }));
vi.mock("@/lib/notes", () => ({ listNotes: vi.fn(), listNotesByInquiryIds: vi.fn() }));
vi.mock("@/lib/events", () => ({ listEvents: vi.fn() }));
vi.mock("@/lib/templates", () => ({ listTemplates: vi.fn() }));
vi.mock("@/lib/messages", () => ({ listMessages: vi.fn(), listMessagesByInquiryIds: vi.fn() }));

const game = { id: "g1", name: "아르카나 사가", status: "active" as const, logoPath: null, ownerName: null, createdAt: "2026-01-01T00:00:00.000Z", sheetId: null };
const labels = { groupLabels: {}, typeLabels: {}, typeOrder: [] };
const emptyPage = { rows: [], total: 0, page: 1, pageSize: 50 };

function inquiry(overrides: Partial<inquiriesModule.InquiryRow>): inquiriesModule.InquiryRow {
  return {
    id: "inq-1",
    inquiryNo: null,
    gameId: "g1",
    groupKey: "game_usage",
    typeKey: "bug_report",
    gameAccount: "player1",
    companyName: null,
    replyEmail: "a@b.com",
    title: "제목",
    content: "내용",
    status: "new",
    priority: "normal",
    meta: {},
    draftReply: null,
    replyContent: null,
    repliedAt: null,
    gmailThreadId: null,
    locale: null,
    paymentNo: null,
    occurredAt: null,
    deviceInfo: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("loadInboxPage", () => {
  beforeEach(() => {
    vi.mocked(categoriesModule.listGames).mockReset().mockResolvedValue([game]);
    vi.mocked(categoriesModule.listCategoryLabelsForScope).mockReset().mockResolvedValue(labels);
    vi.mocked(inquiriesModule.getInquiryFacetCounts).mockReset().mockResolvedValue(null);
    vi.mocked(inquiriesModule.queryInquiries).mockReset().mockResolvedValue(emptyPage);
    vi.mocked(inquiriesModule.listInquiryIds).mockReset().mockResolvedValue(["inq-1"]);
    vi.mocked(inquiriesModule.listAttachmentSignedUrlsByInquiryIds).mockReset().mockResolvedValue({});
    vi.mocked(inquiriesModule.getInquiryById).mockReset();
    vi.mocked(historyModule.getAccountHistory).mockReset().mockResolvedValue([]);
    vi.mocked(notesModule.listNotes).mockReset().mockResolvedValue([]);
    vi.mocked(notesModule.listNotesByInquiryIds).mockReset().mockResolvedValue({});
    vi.mocked(eventsModule.listEvents).mockReset().mockResolvedValue([]);
    vi.mocked(templatesModule.listTemplates).mockReset().mockResolvedValue([]);
    vi.mocked(messagesModule.listMessages).mockReset().mockResolvedValue([]);
    vi.mocked(messagesModule.listMessagesByInquiryIds).mockReset().mockResolvedValue({});
  });

  it("returns null for an unknown game", async () => {
    await expect(loadInboxPage({} as never, gameScope("nope"), null, {})).resolves.toBeNull();
  });

  it("loads a game inbox with the game row and its title", async () => {
    const data = await loadInboxPage({} as never, gameScope("g1"), null, { status: "new" });
    expect(data).toMatchObject({ title: "아르카나 사가", game, selected: null });
    expect(data?.query.status).toBe("new");
    expect(inquiriesModule.queryInquiries).toHaveBeenCalledWith({}, { kind: "game", gameId: "g1" }, expect.objectContaining({ status: "new" }));
    expect(categoriesModule.listCategoryLabelsForScope).toHaveBeenCalledWith({}, { kind: "game", gameId: "g1" });
  });

  it("loads the service inbox without looking up games", async () => {
    const data = await loadInboxPage({} as never, SERVICE_SCOPE, null, {});
    expect(data).toMatchObject({ title: "서비스 문의", game: null });
    expect(categoriesModule.listGames).not.toHaveBeenCalled();
    expect(inquiriesModule.getInquiryFacetCounts).toHaveBeenCalledWith({}, { kind: "service" });
  });

  it("returns null when the selected inquiry is missing or outside the scope", async () => {
    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(null);
    await expect(loadInboxPage({} as never, gameScope("g1"), "inq-1", {})).resolves.toBeNull();

    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(inquiry({ gameId: "g2" }));
    await expect(loadInboxPage({} as never, gameScope("g1"), "inq-1", {})).resolves.toBeNull();

    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(inquiry({ gameId: "g1" }));
    await expect(loadInboxPage({} as never, SERVICE_SCOPE, "inq-1", {})).resolves.toBeNull();
  });

  it("game scope: loads history, past threads, and templates for the selected inquiry", async () => {
    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(inquiry({}));
    vi.mocked(historyModule.getAccountHistory).mockResolvedValue([
      { id: "inq-0", inquiryNo: null, title: "예전", content: "…", status: "resolved", groupKey: "game_usage", typeKey: "bug_report", occurredAt: null, paymentNo: null, deviceInfo: null, createdAt: "2026-08-01T00:00:00.000Z" },
    ]);

    const data = await loadInboxPage({} as never, gameScope("g1"), "inq-1", {});

    expect(historyModule.getAccountHistory).toHaveBeenCalledWith({}, "g1", "player1", "inq-1");
    expect(templatesModule.listTemplates).toHaveBeenCalledWith({}, "g1");
    expect(data?.selected?.history).toHaveLength(1);
    expect(data?.selected?.pastThreads).toHaveLength(1);
    expect(data?.selected?.pastThreads[0].inquiry.id).toBe("inq-0");
    expect(data?.selected?.siblingIds).toEqual(["inq-1"]);
  });

  it("service scope: skips history and templates and hands the panel a null history", async () => {
    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(inquiry({ gameId: null, gameAccount: null, companyName: "플레이컴퍼니" }));

    const data = await loadInboxPage({} as never, SERVICE_SCOPE, "inq-1", {});

    expect(historyModule.getAccountHistory).not.toHaveBeenCalled();
    expect(templatesModule.listTemplates).not.toHaveBeenCalled();
    expect(data?.selected).toMatchObject({ history: null, pastThreads: [], templates: [] });
    expect(inquiriesModule.listInquiryIds).toHaveBeenCalledWith({}, { kind: "service" }, expect.anything());
  });

  it("fetches the selected and past inquiries' attachments in one batched lookup", async () => {
    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(inquiry({}));
    vi.mocked(historyModule.getAccountHistory).mockResolvedValue([
      { id: "inq-0", inquiryNo: null, title: "예전", content: "…", status: "resolved", groupKey: "game_usage", typeKey: "bug_report", occurredAt: null, paymentNo: null, deviceInfo: null, createdAt: "2026-08-01T00:00:00.000Z" },
    ]);
    vi.mocked(inquiriesModule.listAttachmentSignedUrlsByInquiryIds).mockResolvedValue({
      "inq-1": [{ id: "att-1", fileName: "now.png", signedUrl: "https://signed.example/now" }],
      "inq-0": [{ id: "att-0", fileName: "then.png", signedUrl: "https://signed.example/then" }],
    });

    const data = await loadInboxPage({} as never, gameScope("g1"), "inq-1", {});

    expect(inquiriesModule.listAttachmentSignedUrlsByInquiryIds).toHaveBeenCalledTimes(1);
    expect(inquiriesModule.listAttachmentSignedUrlsByInquiryIds).toHaveBeenCalledWith({}, ["inq-1", "inq-0"]);
    expect(data?.selected?.attachments).toEqual([{ id: "att-1", fileName: "now.png", signedUrl: "https://signed.example/now" }]);
    expect(data?.selected?.pastThreads[0].attachments).toEqual([{ id: "att-0", fileName: "then.png", signedUrl: "https://signed.example/then" }]);
  });

  it("starts the per-inquiry lookups without waiting for the inquiry row", async () => {
    let releaseInquiry: (row: inquiriesModule.InquiryRow) => void = () => {};
    vi.mocked(inquiriesModule.getInquiryById).mockReturnValue(new Promise((resolve) => { releaseInquiry = resolve; }));

    const pending = loadInboxPage({} as never, gameScope("g1"), "inq-1", {});
    await Promise.resolve();

    expect(messagesModule.listMessages).toHaveBeenCalledWith({}, "inq-1");
    expect(notesModule.listNotes).toHaveBeenCalledWith({}, "inq-1");
    expect(eventsModule.listEvents).toHaveBeenCalledWith({}, "inq-1");
    expect(templatesModule.listTemplates).toHaveBeenCalledWith({}, "g1");
    expect(inquiriesModule.listInquiryIds).toHaveBeenCalledWith({}, { kind: "game", gameId: "g1" }, expect.anything());

    releaseInquiry(inquiry({}));
    await expect(pending).resolves.toMatchObject({ selected: { inquiry: { id: "inq-1" } } });
  });
});
