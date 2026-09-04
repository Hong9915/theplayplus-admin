import { describe, it, expect, vi } from "vitest";
import { listRecentRepliesByType } from "@/lib/replies";
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
