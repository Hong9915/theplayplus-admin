import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/assistant/conversations/[id]/messages/route";
import { readNdjson } from "@/lib/ndjson";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as storeModule from "@/lib/assistant-store";
import * as sheetsModule from "@/lib/sheets";
import * as assistantModule from "@/lib/assistant";
import * as categoriesModule from "@/lib/categories";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn(() => ({})) }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn(), getAdminSession: vi.fn() }));
vi.mock("@/lib/categories", () => ({ listGames: vi.fn() }));
vi.mock("@/lib/assistant-store", () => ({
  getConversation: vi.fn(),
  insertMessage: vi.fn(),
  listMessages: vi.fn(),
  touchConversation: vi.fn(),
  toHistory: vi.fn((messages: unknown[]) => messages),
}));
vi.mock("@/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheets")>();
  return { ...actual, readSpreadsheet: vi.fn() };
});
vi.mock("@/lib/assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant")>();
  return { ...actual, streamAssistant: vi.fn() };
});

const game = { id: "g1", name: "여신 키우기", status: "active", logoPath: null, ownerName: null, createdAt: "", sheetId: "sheet-1" };
const conversation = { id: "c1", gameId: "g1", title: "t", createdBy: "a@b", createdAt: "", updatedAt: "" };
const tabs = [{ title: "VIP", header: ["이메일", "VIP 단계"], rows: [["이메일", "VIP 단계"], ["a@x.com", "VIP3"]] }];
const proposal = { kind: "update" as const, sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] };

function request(body: unknown) {
  return new Request("http://localhost/api/assistant/conversations/c1/messages", { method: "POST", body: JSON.stringify(body) });
}

async function events(response: Response) {
  const out: unknown[] = [];
  for await (const event of readNdjson(response.body!)) out.push(event);
  return out;
}

function stream(...items: assistantModule.AssistantEvent[]) {
  return (async function* () {
    for (const item of items) yield item;
  })();
}

describe("POST /api/assistant/conversations/[id]/messages", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(categoriesModule.listGames).mockReset().mockResolvedValue([game] as never);
    vi.mocked(storeModule.getConversation).mockReset().mockResolvedValue(conversation);
    vi.mocked(storeModule.listMessages).mockReset().mockResolvedValue([]);
    vi.mocked(storeModule.touchConversation).mockReset().mockResolvedValue(undefined);
    let counter = 0;
    vi.mocked(storeModule.insertMessage).mockReset().mockImplementation(async (_s, input) => ({
      id: `m${++counter}`,
      conversationId: "c1",
      role: input.role,
      content: input.content ?? "",
      proposal: input.proposal ?? null,
      status: input.status ?? null,
      failureReason: null,
      appliedBy: null,
      appliedAt: null,
      createdAt: "",
    }));
    vi.mocked(sheetsModule.readSpreadsheet).mockReset().mockResolvedValue(tabs);
    vi.mocked(assistantModule.streamAssistant).mockReset();
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await POST(request({ content: "x" }), { params: { id: "c1" } })).status).toBe(401);
  });

  it("rejects empty content", async () => {
    expect((await POST(request({ content: "   " }), { params: { id: "c1" } })).status).toBe(400);
    expect(storeModule.insertMessage).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown conversation or game", async () => {
    vi.mocked(storeModule.getConversation).mockResolvedValue(null);
    expect((await POST(request({ content: "x" }), { params: { id: "c1" } })).status).toBe(404);
  });

  it("returns 400 not_configured when the game has no sheet", async () => {
    vi.mocked(categoriesModule.listGames).mockResolvedValue([{ ...game, sheetId: null }] as never);
    const response = await POST(request({ content: "x" }), { params: { id: "c1" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "not_configured" });
  });

  it("stores the user message, streams text, and stores the assistant reply", async () => {
    vi.mocked(assistantModule.streamAssistant).mockReturnValue(stream({ type: "text", text: "VIP3" }, { type: "text", text: "입니다" }));

    const response = await POST(request({ content: "52009 VIP?" }), { params: { id: "c1" } });

    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(await events(response)).toEqual([
      { type: "text", text: "VIP3" },
      { type: "text", text: "입니다" },
    ]);
    expect(storeModule.insertMessage).toHaveBeenNthCalledWith(1, expect.anything(), { conversationId: "c1", role: "user", content: "52009 VIP?" });
    expect(storeModule.insertMessage).toHaveBeenNthCalledWith(2, expect.anything(), { conversationId: "c1", role: "assistant", content: "VIP3입니다" });
    expect(storeModule.touchConversation).toHaveBeenCalledWith(expect.anything(), "c1");

    const args = vi.mocked(assistantModule.streamAssistant).mock.calls[0][0];
    expect(args.system).toContain("여신 키우기");
    expect(args.system).toContain("## VIP");
    expect(args.tabs).toEqual(tabs);
  });

  it("stores proposals as pending and streams their message id", async () => {
    vi.mocked(assistantModule.streamAssistant).mockReturnValue(stream({ type: "proposal", proposal }));

    const response = await POST(request({ content: "VIP4로 올려줘" }), { params: { id: "c1" } });

    expect(await events(response)).toEqual([{ type: "proposal", messageId: "m2", proposal }]);
    expect(storeModule.insertMessage).toHaveBeenNthCalledWith(2, expect.anything(), { conversationId: "c1", role: "proposal", proposal, status: "pending" });
    // 본문이 비었으니 assistant 행은 만들지 않는다.
    expect(storeModule.insertMessage).toHaveBeenCalledTimes(2);
  });

  it("streams a sheet read failure as one error event and keeps the user message", async () => {
    vi.mocked(sheetsModule.readSpreadsheet).mockRejectedValue(new sheetsModule.SheetError("sheet_forbidden"));

    const response = await POST(request({ content: "x" }), { params: { id: "c1" } });

    expect(await events(response)).toEqual([{ type: "error", reason: "sheet_forbidden" }]);
    expect(storeModule.insertMessage).toHaveBeenCalledTimes(1);
    expect(assistantModule.streamAssistant).not.toHaveBeenCalled();
  });

  it("does not store the assistant text when the stream ends in error", async () => {
    vi.mocked(assistantModule.streamAssistant).mockReturnValue(stream({ type: "text", text: "일부" }, { type: "error", reason: "model_failed" }));

    const response = await POST(request({ content: "x" }), { params: { id: "c1" } });

    expect(await events(response)).toEqual([
      { type: "text", text: "일부" },
      { type: "error", reason: "model_failed" },
    ]);
    expect(storeModule.insertMessage).toHaveBeenCalledTimes(1);
  });
});
