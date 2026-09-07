import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/assistant/conversations/[id]/messages/route";
import { readNdjson } from "@/lib/ndjson";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as storeModule from "@/lib/assistant-store";
import * as sheetsModule from "@/lib/sheets";
import * as assistantModule from "@/lib/assistant";
import * as categoriesModule from "@/lib/categories";
import * as sourcesModule from "@/lib/assistant-sources";

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
vi.mock("@/lib/assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant")>();
  return { ...actual, streamAssistant: vi.fn() };
});
vi.mock("@/lib/assistant-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant-sources")>();
  return { ...actual, listSources: vi.fn(), loadSources: vi.fn() };
});

const game = { id: "g1", name: "여신 키우기", status: "active", logoPath: null, ownerName: null, createdAt: "" };
const conversation = { id: "c1", gameId: "g1", title: "t", createdBy: "a@b", createdAt: "", updatedAt: "" };
const tabs = [{ title: "VIP", header: ["이메일", "VIP 단계"], rows: [["이메일", "VIP 단계"], ["a@x.com", "VIP3"]] }];
const sheetSource = { id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "sheet-1", title: "VIP 원장", createdAt: "" };
const docSource = { id: "s2", gameId: "g1", kind: "doc" as const, externalId: "doc-1", title: "운영 가이드", createdAt: "" };
const loaded = [
  { source: sheetSource, kind: "sheet" as const, tabs },
  { source: docSource, kind: "doc" as const, text: "환불은 7일" },
];
const proposal = { kind: "update" as const, sourceId: "s1", sourceTitle: "VIP 원장", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] };

function request(body: unknown) {
  return new Request("http://localhost/api/assistant/conversations/c1/messages", { method: "POST", body: JSON.stringify(body) });
}

function multipart(content: string, files: Array<{ name: string; text: string }>) {
  const form = new FormData();
  form.set("content", content);
  for (const file of files) form.append("files", new File([file.text], file.name, { type: "text/plain" }));
  return new Request("http://localhost/api/assistant/conversations/c1/messages", { method: "POST", body: form });
}

function userMessage(id: string, content: string, attachments: Array<{ name: string; size: number; text: string }>) {
  return { id, conversationId: "c1", role: "user" as const, content, proposal: null, status: null, failureReason: null, appliedBy: null, appliedAt: null, attachments, createdAt: "" };
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
      attachments: input.attachments ?? [],
      createdAt: "",
    }));
    vi.mocked(assistantModule.streamAssistant).mockReset();
    vi.mocked(sourcesModule.listSources).mockReset().mockResolvedValue([sheetSource, docSource]);
    vi.mocked(sourcesModule.loadSources).mockReset().mockResolvedValue(loaded);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await POST(request({ content: "x" }), { params: { id: "c1" } })).status).toBe(401);
  });

  it("rejects empty content", async () => {
    expect((await POST(request({ content: "   " }), { params: { id: "c1" } })).status).toBe(400);
    expect(storeModule.insertMessage).not.toHaveBeenCalled();
  });

  it("rejects a JSON body that is the literal null", async () => {
    const req = new Request("http://localhost/api/assistant/conversations/c1/messages", { method: "POST", body: "null" });
    expect((await POST(req, { params: { id: "c1" } })).status).toBe(400);
    expect(storeModule.insertMessage).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown conversation or game", async () => {
    vi.mocked(storeModule.getConversation).mockResolvedValue(null);
    expect((await POST(request({ content: "x" }), { params: { id: "c1" } })).status).toBe(404);
  });

  it("returns 400 not_configured when the game has no sources", async () => {
    vi.mocked(sourcesModule.listSources).mockResolvedValue([]);
    const response = await POST(request({ content: "hi" }), { params: { id: "c1" } });
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

    const call = vi.mocked(assistantModule.streamAssistant).mock.calls[0][0];
    expect(call.system).toContain("여신 키우기");
    expect(call.system).toContain("## VIP");
    expect(call.system).toContain("# 시트: VIP 원장");
    expect(call.system).toContain("# 문서: 운영 가이드");
    expect(call.sources).toBe(loaded);
  });

  it("stores proposals as pending and streams their message id", async () => {
    vi.mocked(assistantModule.streamAssistant).mockReturnValue(stream({ type: "text", text: "바꿀게요" }, { type: "proposal", proposal }));

    const response = await POST(request({ content: "VIP4로 올려줘" }), { params: { id: "c1" } });

    expect(await events(response)).toEqual([
      { type: "text", text: "바꿀게요" },
      { type: "proposal", messageId: "m3", proposal },
    ]);
    // 스트림 순서(본문 먼저, 그다음 제안)대로 저장한다: user → assistant → proposal.
    expect(storeModule.insertMessage).toHaveBeenNthCalledWith(1, expect.anything(), { conversationId: "c1", role: "user", content: "VIP4로 올려줘" });
    expect(storeModule.insertMessage).toHaveBeenNthCalledWith(2, expect.anything(), { conversationId: "c1", role: "assistant", content: "바꿀게요" });
    expect(storeModule.insertMessage).toHaveBeenNthCalledWith(3, expect.anything(), { conversationId: "c1", role: "proposal", proposal, status: "pending" });
    expect(storeModule.insertMessage).toHaveBeenCalledTimes(3);
  });

  it("streams a source read failure with its title as one error event and keeps the user message", async () => {
    const error = new sheetsModule.SheetError("source_forbidden");
    error.sourceTitle = "운영 가이드";
    vi.mocked(sourcesModule.loadSources).mockRejectedValue(error);
    const response = await POST(request({ content: "hi" }), { params: { id: "c1" } });
    expect(await events(response)).toEqual([{ type: "error", reason: "source_forbidden", sourceTitle: "운영 가이드" }]);
    expect(storeModule.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("stores multipart attachments with the user message and puts their text in the prompt", async () => {
    vi.mocked(assistantModule.streamAssistant).mockReturnValue(stream({ type: "text", text: "확인했습니다" }));

    const response = await POST(multipart("이 파일 봐줘", [{ name: "보상.txt", text: "52009 VIP3" }]), { params: { id: "c1" } });

    expect(await events(response)).toEqual([{ type: "text", text: "확인했습니다" }]);
    expect(storeModule.insertMessage).toHaveBeenNthCalledWith(1, expect.anything(), {
      conversationId: "c1",
      role: "user",
      content: "이 파일 봐줘",
      attachments: [{ name: "보상.txt", size: 10, text: "52009 VIP3" }],
    });
    const args = vi.mocked(assistantModule.streamAssistant).mock.calls[0][0];
    expect(args.system).toContain("# 첨부 파일");
    expect(args.system).toContain("## 보상.txt\n52009 VIP3");
  });

  it("accepts a file with no text", async () => {
    vi.mocked(assistantModule.streamAssistant).mockReturnValue(stream({ type: "text", text: "네" }));
    const response = await POST(multipart("  ", [{ name: "a.txt", text: "x" }]), { params: { id: "c1" } });
    expect(response.status).toBe(200);
    expect(storeModule.insertMessage).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({ role: "user", content: "" }));
  });

  it("rejects multipart with neither text nor files", async () => {
    expect((await POST(multipart("", []), { params: { id: "c1" } })).status).toBe(400);
    expect(storeModule.insertMessage).not.toHaveBeenCalled();
  });

  it("rejects unsupported file types before saving anything", async () => {
    const response = await POST(multipart("x", [{ name: "a.pdf", text: "x" }]), { params: { id: "c1" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "unsupported_type" });
    expect(storeModule.insertMessage).not.toHaveBeenCalled();
  });

  it("rejects more than five files", async () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, text: "x" }));
    const response = await POST(multipart("x", files), { params: { id: "c1" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "too_many_files" });
  });

  it("rejects a message whose files together exceed the per-message byte cap", async () => {
    const form = new FormData();
    form.set("content", "x");
    // multipart를 거치면 size를 흉내 낼 수 없어 실제 크기로 만든다.
    form.append("files", new File(["x".repeat(3 * 1024 * 1024)], "a.txt", { type: "text/plain" }));
    form.append("files", new File(["x".repeat(2 * 1024 * 1024)], "b.txt", { type: "text/plain" }));
    const req = new Request("http://localhost/api/assistant/conversations/c1/messages", { method: "POST", body: form });

    const response = await POST(req, { params: { id: "c1" } });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "message_too_large" });
    expect(storeModule.insertMessage).not.toHaveBeenCalled();
  });

  it("rejects files once the conversation's attachment text would exceed the cap", async () => {
    vi.mocked(storeModule.listMessages).mockResolvedValue([userMessage("m0", "", [{ name: "big.txt", size: 1, text: "x".repeat(199_995) }])]);
    const response = await POST(multipart("x", [{ name: "more.txt", text: "123456" }]), { params: { id: "c1" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "attachments_too_large" });
    expect(storeModule.insertMessage).not.toHaveBeenCalled();
  });

  it("keeps earlier attachments of the conversation in the prompt", async () => {
    vi.mocked(storeModule.listMessages).mockResolvedValue([userMessage("m0", "먼저", [{ name: "old.txt", size: 3, text: "old" }])]);
    vi.mocked(assistantModule.streamAssistant).mockReturnValue(stream({ type: "text", text: "네" }));

    await events(await POST(request({ content: "다시" }), { params: { id: "c1" } }));

    const args = vi.mocked(assistantModule.streamAssistant).mock.calls[0][0];
    expect(args.system).toContain("## old.txt\nold");
    expect(args.history).toHaveLength(2);
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
