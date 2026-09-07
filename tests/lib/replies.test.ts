import { describe, it, expect, vi } from "vitest";
import { listRecentRepliesByType, listSimilarAnsweredReplies, mergePastReplies, type PastReply } from "@/lib/replies";
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";

function mockClient(data: unknown, error: { message: string } | null = null) {
  const limit = vi.fn().mockResolvedValue({ data, error });
  const order = vi.fn(() => ({ limit }));
  const not = vi.fn(() => ({ order }));
  const eqType = vi.fn(() => ({ not }));
  const eqGame = vi.fn(() => ({ eq: eqType }));
  const isGame = vi.fn(() => ({ eq: eqType }));
  const select = vi.fn(() => ({ eq: eqGame, is: isGame }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eqGame, isGame, eqType, not, order, limit };
}

describe("listRecentRepliesByType", () => {
  it("filters by game and type, excludes unanswered, and takes the newest first", async () => {
    const { from, select, eqGame, eqType, not, order, limit } = mockClient([
      { reply_content: "확인 후 조치했습니다" },
      { reply_content: "환불 처리했습니다" },
    ]);

    const result = await listRecentRepliesByType({ from } as never, gameScope("game-1"), "payment_refund");

    expect(from).toHaveBeenCalledWith("inquiries");
    expect(select).toHaveBeenCalledWith("reply_content");
    expect(eqGame).toHaveBeenCalledWith("game_id", "game-1");
    expect(eqType).toHaveBeenCalledWith("type_key", "payment_refund");
    expect(not).toHaveBeenCalledWith("reply_content", "is", null);
    expect(order).toHaveBeenCalledWith("replied_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(3);
    expect(result).toEqual(["확인 후 조치했습니다", "환불 처리했습니다"]);
  });

  it("service scope looks up replies where game_id is null", async () => {
    const { from, eqGame, isGame, eqType } = mockClient([{ reply_content: "제휴 제안 감사합니다" }]);

    const result = await listRecentRepliesByType({ from } as never, SERVICE_SCOPE, "publishing");

    expect(isGame).toHaveBeenCalledWith("game_id", null);
    expect(eqGame).not.toHaveBeenCalled();
    expect(eqType).toHaveBeenCalledWith("type_key", "publishing");
    expect(result).toEqual(["제휴 제안 감사합니다"]);
  });

  it("honours an explicit limit", async () => {
    const { from, limit } = mockClient([]);
    await listRecentRepliesByType({ from } as never, gameScope("game-1"), "bug_report", 5);
    expect(limit).toHaveBeenCalledWith(5);
  });

  it("drops null and blank bodies that slipped through", async () => {
    const { from } = mockClient([
      { reply_content: "실제 답변" },
      { reply_content: null },
      { reply_content: "   " },
    ]);

    await expect(listRecentRepliesByType({ from } as never, gameScope("game-1"), "bug_report")).resolves.toEqual([
      "실제 답변",
    ]);
  });

  it("returns an empty array when the query errors", async () => {
    const { from } = mockClient(null, { message: "db error" });
    await expect(listRecentRepliesByType({ from } as never, gameScope("game-1"), "bug_report")).resolves.toEqual([]);
  });
});

describe("listSimilarAnsweredReplies", () => {
  const embedding = [0.1, 0.2, 0.3];

  function rpcClient(data: unknown, error: { message: string } | null = null) {
    const rpc = vi.fn().mockResolvedValue({ data, error });
    return { client: { rpc } as never, rpc };
  }

  it("calls the RPC with the game id, vector, excluded inquiry, and limit", async () => {
    const { client, rpc } = rpcClient([
      { id: "old-1", inquiry_no: "R-1", title: "결제 안 됨", content: "카드 결제가 두 번 됐어요", reply_body: "환불 처리했습니다", similarity: 0.8 },
    ]);

    const result = await listSimilarAnsweredReplies(client, gameScope("game-1"), embedding, "inq-1");

    expect(rpc).toHaveBeenCalledWith("match_answered_inquiries", {
      p_game_id: "game-1",
      p_query: embedding,
      p_exclude_id: "inq-1",
      p_limit: 5,
    });
    expect(result).toEqual<PastReply[]>([
      { inquiryNo: "R-1", title: "결제 안 됨", excerpt: "카드 결제가 두 번 됐어요", reply: "환불 처리했습니다" },
    ]);
  });

  it("passes null for the service scope and honours the limit", async () => {
    const { client, rpc } = rpcClient([]);

    await listSimilarAnsweredReplies(client, SERVICE_SCOPE, embedding, "inq-1", 3);

    expect(rpc).toHaveBeenCalledWith("match_answered_inquiries", expect.objectContaining({ p_game_id: null, p_limit: 3 }));
  });

  it("cuts the excerpt at 500 characters and drops rows without a reply body", async () => {
    const { client } = rpcClient([
      { id: "a", inquiry_no: "R-1", title: "긴 문의", content: "가".repeat(700), reply_body: "답변", similarity: 0.9 },
      { id: "b", inquiry_no: "R-2", title: "빈 답변", content: "본문", reply_body: "   ", similarity: 0.7 },
      { id: "c", inquiry_no: null, title: "null 답변", content: "본문", reply_body: null, similarity: 0.6 },
    ]);

    const result = await listSimilarAnsweredReplies(client, gameScope("game-1"), embedding, "inq-1");

    expect(result).toHaveLength(1);
    expect(result[0].excerpt).toHaveLength(500);
  });

  it("returns an empty array when the RPC errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = rpcClient(null, { message: "function does not exist" });
    await expect(listSimilarAnsweredReplies(client, gameScope("game-1"), embedding, "inq-1")).resolves.toEqual([]);
    warnSpy.mockRestore();
  });
});

describe("mergePastReplies", () => {
  const similar = (reply: string): PastReply => ({ inquiryNo: "R-1", title: "제목", excerpt: "요약", reply });

  it("keeps similar replies alone when there are at least two", () => {
    const result = mergePastReplies([similar("A"), similar("B")], ["C"]);
    expect(result.map((entry) => entry.reply)).toEqual(["A", "B"]);
  });

  it("appends recent replies as fallback entries when fewer than two similar ones exist", () => {
    const result = mergePastReplies([similar("A")], ["C", "D"]);
    expect(result).toEqual([
      similar("A"),
      { inquiryNo: null, title: null, excerpt: null, reply: "C" },
      { inquiryNo: null, title: null, excerpt: null, reply: "D" },
    ]);
  });

  it("skips recent replies whose body already appears among the similar ones", () => {
    const result = mergePastReplies([similar("A")], ["A", "B"]);
    expect(result.map((entry) => entry.reply)).toEqual(["A", "B"]);
  });

  it("uses only recent replies when nothing similar was found", () => {
    expect(mergePastReplies([], ["X"])).toEqual([{ inquiryNo: null, title: null, excerpt: null, reply: "X" }]);
  });
});
