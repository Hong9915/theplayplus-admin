import { describe, it, expect, vi } from "vitest";
import { getAccountHistory } from "@/lib/account-history";

describe("getAccountHistory", () => {
  it("returns an empty array without querying when game_account is empty", async () => {
    const from = vi.fn();
    const result = await getAccountHistory({ from } as never, "game-1", "", "inq-1");
    expect(result).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns an empty array without querying when game_account is null", async () => {
    const from = vi.fn();
    const result = await getAccountHistory({ from } as never, "game-1", null, "inq-1");
    expect(result).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("filters by game_id, game_account, and excludes the current inquiry", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: "inq-2",
          inquiry_no: "R-20250601-0003",
          title: "이전 문의",
          content: "지난주에 결제한 다이아가 아직 안 들어왔습니다.",
          status: "resolved",
          group_key: "game_usage",
          type_key: "account_login",
          created_at: "2025-06-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const neq = vi.fn(() => ({ order }));
    const eqAccount = vi.fn(() => ({ neq }));
    const eqGame = vi.fn(() => ({ eq: eqAccount }));
    const select = vi.fn(() => ({ eq: eqGame }));
    const from = vi.fn(() => ({ select }));

    const result = await getAccountHistory({ from } as never, "game-1", "player1", "inq-1");

    expect(select).toHaveBeenCalledWith(expect.stringContaining("content"));
    expect(select).toHaveBeenCalledWith(expect.stringContaining("inquiry_no"));
    expect(eqGame).toHaveBeenCalledWith("game_id", "game-1");
    expect(eqAccount).toHaveBeenCalledWith("game_account", "player1");
    expect(neq).toHaveBeenCalledWith("id", "inq-1");
    expect(result).toEqual([
      {
        id: "inq-2",
        inquiryNo: "R-20250601-0003",
        title: "이전 문의",
        content: "지난주에 결제한 다이아가 아직 안 들어왔습니다.",
        status: "resolved",
        groupKey: "game_usage",
        typeKey: "account_login",
        createdAt: "2025-06-01T00:00:00.000Z",
      },
    ]);
  });

  it("throws when the query errors", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    const neq = vi.fn(() => ({ order }));
    const eqAccount = vi.fn(() => ({ neq }));
    const eqGame = vi.fn(() => ({ eq: eqAccount }));
    const select = vi.fn(() => ({ eq: eqGame }));
    const from = vi.fn(() => ({ select }));

    await expect(getAccountHistory({ from } as never, "game-1", "player1", "inq-1")).rejects.toThrow(/db error/);
  });
});
