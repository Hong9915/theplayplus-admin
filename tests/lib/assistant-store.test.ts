import { describe, it, expect, vi } from "vitest";
import {
  conversationTitle,
  listConversations,
  createConversation,
  deleteConversation,
  listMessages,
  insertMessage,
  updateProposalStatus,
  toHistory,
  type MessageRow,
} from "@/lib/assistant-store";

const conversationRow = {
  id: "c1",
  game_id: "g1",
  title: "VIP 확인",
  created_by: "admin@theplayplus.com",
  created_at: "2026-09-04T01:00:00.000Z",
  updated_at: "2026-09-04T02:00:00.000Z",
};

const messageRow = {
  id: "m1",
  conversation_id: "c1",
  role: "proposal",
  content: "",
  proposal: { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] },
  status: "pending",
  failure_reason: null,
  applied_by: null,
  applied_at: null,
  attachments: null,
  created_at: "2026-09-04T01:01:00.000Z",
};

describe("conversationTitle", () => {
  it("trims and cuts to 40 characters", () => {
    expect(conversationTitle("  안녕  ")).toBe("안녕");
    expect(conversationTitle("가".repeat(50))).toHaveLength(40);
    expect(conversationTitle("   ")).toBe("새 대화");
  });
});

describe("listConversations", () => {
  it("filters by game and orders by updated_at desc", async () => {
    const order = vi.fn().mockResolvedValue({ data: [conversationRow], error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await listConversations({ from } as never, "g1");

    expect(from).toHaveBeenCalledWith("assistant_conversations");
    expect(eq).toHaveBeenCalledWith("game_id", "g1");
    expect(order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(result).toEqual([
      { id: "c1", gameId: "g1", title: "VIP 확인", createdBy: "admin@theplayplus.com", createdAt: conversationRow.created_at, updatedAt: conversationRow.updated_at },
    ]);
  });
});

describe("createConversation", () => {
  it("inserts and returns the mapped row", async () => {
    const single = vi.fn().mockResolvedValue({ data: conversationRow, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));

    const result = await createConversation({ from } as never, { gameId: "g1", title: "VIP 확인", createdBy: "admin@theplayplus.com" });

    expect(insert).toHaveBeenCalledWith({ game_id: "g1", title: "VIP 확인", created_by: "admin@theplayplus.com" });
    expect(result?.id).toBe("c1");
  });
  it("returns null on error", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "x" } });
    const from = vi.fn(() => ({ insert: () => ({ select: () => ({ single }) }) }));
    expect(await createConversation({ from } as never, { gameId: "g1", title: "t", createdBy: "a" })).toBeNull();
  });
});

describe("deleteConversation", () => {
  it("deletes by id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ delete: () => ({ eq }) }));
    expect(await deleteConversation({ from } as never, "c1")).toBe(true);
    expect(eq).toHaveBeenCalledWith("id", "c1");
  });
});

describe("listMessages", () => {
  it("orders oldest first and maps proposal fields", async () => {
    const order = vi.fn().mockResolvedValue({ data: [messageRow], error: null });
    const eq = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select: () => ({ eq }) }));

    const result = await listMessages({ from } as never, "c1");

    expect(eq).toHaveBeenCalledWith("conversation_id", "c1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result[0]).toEqual({
      id: "m1",
      conversationId: "c1",
      role: "proposal",
      content: "",
      proposal: messageRow.proposal,
      status: "pending",
      failureReason: null,
      appliedBy: null,
      appliedAt: null,
      attachments: [],
      createdAt: messageRow.created_at,
    });
  });

  it("maps stored attachments", async () => {
    const attachments = [{ name: "보상.txt", size: 12, text: "52009 VIP3" }];
    const order = vi.fn().mockResolvedValue({ data: [{ ...messageRow, role: "user", content: "확인", attachments }], error: null });
    const from = vi.fn(() => ({ select: () => ({ eq: () => ({ order }) }) }));

    const result = await listMessages({ from } as never, "c1");

    expect(result[0].attachments).toEqual(attachments);
  });
});

describe("insertMessage", () => {
  it("writes proposal rows with pending status", async () => {
    const single = vi.fn().mockResolvedValue({ data: messageRow, error: null });
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    const from = vi.fn(() => ({ insert }));

    await insertMessage({ from } as never, { conversationId: "c1", role: "proposal", proposal: messageRow.proposal as never, status: "pending" });

    expect(insert).toHaveBeenCalledWith({
      conversation_id: "c1",
      role: "proposal",
      content: "",
      proposal: messageRow.proposal,
      status: "pending",
      attachments: null,
    });
  });
  it("writes text rows without proposal", async () => {
    const single = vi.fn().mockResolvedValue({ data: { ...messageRow, role: "user", content: "hi", proposal: null, status: null }, error: null });
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    const from = vi.fn(() => ({ insert }));

    await insertMessage({ from } as never, { conversationId: "c1", role: "user", content: "hi" });

    expect(insert).toHaveBeenCalledWith({ conversation_id: "c1", role: "user", content: "hi", proposal: null, status: null, attachments: null });
  });

  it("writes attachments on user rows", async () => {
    const attachments = [{ name: "보상.txt", size: 12, text: "52009 VIP3" }];
    const single = vi.fn().mockResolvedValue({ data: { ...messageRow, role: "user", content: "", proposal: null, status: null, attachments }, error: null });
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    const from = vi.fn(() => ({ insert }));

    const result = await insertMessage({ from } as never, { conversationId: "c1", role: "user", content: "", attachments });

    expect(insert).toHaveBeenCalledWith({ conversation_id: "c1", role: "user", content: "", proposal: null, status: null, attachments });
    expect(result?.attachments).toEqual(attachments);
  });
});

describe("updateProposalStatus", () => {
  it("patches status and applied fields", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));

    const ok = await updateProposalStatus({ from } as never, "m1", { status: "applied", appliedBy: "a@b", appliedAt: "2026-09-04T03:00:00.000Z" });

    expect(ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ status: "applied", failure_reason: null, applied_by: "a@b", applied_at: "2026-09-04T03:00:00.000Z" });
    expect(eq).toHaveBeenCalledWith("id", "m1");
  });
});

describe("toHistory", () => {
  it("keeps only the last 20 messages", () => {
    const messages: MessageRow[] = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`,
      conversationId: "c1",
      role: "user",
      content: `q${i}`,
      proposal: null,
      status: null,
      failureReason: null,
      appliedBy: null,
      appliedAt: null,
      attachments: [],
      createdAt: "2026-09-04T00:00:00.000Z",
    }));
    const history = toHistory(messages);
    expect(history).toHaveLength(20);
    expect(history[0].content).toBe("q5");
    expect(history[19]).toEqual({ role: "user", content: "q24", proposal: null, status: null, attachmentNames: [] });
  });

  it("carries attachment names into history", () => {
    const message: MessageRow = {
      id: "m1",
      conversationId: "c1",
      role: "user",
      content: "확인",
      proposal: null,
      status: null,
      failureReason: null,
      appliedBy: null,
      appliedAt: null,
      attachments: [{ name: "보상.txt", size: 3, text: "abc" }],
      createdAt: "2026-09-04T00:00:00.000Z",
    };
    expect(toHistory([message])[0].attachmentNames).toEqual(["보상.txt"]);
  });
});
