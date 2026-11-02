import { describe, it, expect, vi } from "vitest";
import { countAdminNotifications, withTitleCount } from "@/lib/notification-count";

describe("withTitleCount", () => {
  it("prefixes the count with thousands separators", () => {
    expect(withTitleCount("THE PLAY+ Admin", 1094)).toBe("(1,094) THE PLAY+ Admin");
  });
  it("replaces an existing count instead of stacking", () => {
    expect(withTitleCount("(3) THE PLAY+ Admin", 5)).toBe("(5) THE PLAY+ Admin");
    expect(withTitleCount("(1,094) THE PLAY+ Admin", 2)).toBe("(2) THE PLAY+ Admin");
  });
  it("drops the count at zero", () => {
    expect(withTitleCount("(3) THE PLAY+ Admin", 0)).toBe("THE PLAY+ Admin");
    expect(withTitleCount("THE PLAY+ Admin", 0)).toBe("THE PLAY+ Admin");
  });
});

describe("countAdminNotifications", () => {
  function mockUnreadReplies(count: number | null, error: unknown = null) {
    const neq = vi.fn().mockResolvedValue({ count, error });
    const not = vi.fn(() => ({ neq }));
    const select = vi.fn(() => ({ not }));
    const from = vi.fn(() => ({ select }));
    return { client: { from } as never, from, select, not, neq };
  }

  it("sums new inquiries, lounge items and unread replies outside new", async () => {
    const m = mockUnreadReplies(4);
    const total = await countAdminNotifications(m.client, {
      newCounts: { "game-1": 2, service: 1 },
      loungeCounts: { "game-1": 3 },
    });
    expect(total).toBe(2 + 1 + 3 + 4);
    expect(m.from).toHaveBeenCalledWith("inquiries");
    expect(m.not).toHaveBeenCalledWith("unread_reply_at", "is", null);
    expect(m.neq).toHaveBeenCalledWith("status", "new");
  });

  it("treats a failed unread-reply count as zero", async () => {
    const m = mockUnreadReplies(null, { message: "boom" });
    const total = await countAdminNotifications(m.client, { newCounts: { a: 1 }, loungeCounts: {} });
    expect(total).toBe(1);
  });
});
