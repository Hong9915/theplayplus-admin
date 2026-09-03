import { describe, it, expect, vi } from "vitest";
import {
  countInquiriesByGame,
  countNewInquiriesByGame,
  getInquiryById,
  getInquiryFacetCounts,
  listAttachmentSignedUrls,
  listInquiryIds,
  queryInquiries,
  sanitizeSearch,
} from "@/lib/inquiries";
import { DEFAULT_QUERY } from "@/lib/inquiry-filters";

const sampleRow = {
  id: "inq-1",
  game_id: "game-1",
  group_key: "game_usage",
  type_key: "bug_report",
  game_account: "player1",
  company_name: null,
  reply_email: "a@b.com",
  title: "제목",
  content: "내용",
  status: "new",
  reply_content: null,
  replied_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  inquiry_no: "R-20260101-0001",
  priority: "high",
  meta: { uid: "10024871" },
  draft_reply: "작성 중",
};

/**
 * supabase-js 빌더를 흉내 낸다. 모든 필터 메서드가 자기 자신을 돌려주고,
 * await 하면 준비된 결과가 나온다.
 */
function mockBuilder(result: { data?: unknown; error?: { message: string } | null; count?: number | null }) {
  const builder: Record<string, unknown> = {};
  const calls: Record<string, unknown[][]> = {};
  for (const name of ["eq", "neq", "lt", "or", "order", "range", "limit", "in"]) {
    calls[name] = [];
    builder[name] = vi.fn((...args: unknown[]) => {
      calls[name].push(args);
      return builder;
    });
  }
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null, count: null, ...result }).then(resolve);
  const select = vi.fn(() => builder);
  const from = vi.fn(() => ({ select }));
  return { from, select, calls };
}

describe("queryInquiries", () => {
  it("filters by game, orders newest first, and pages with an exact count", async () => {
    const { from, select, calls } = mockBuilder({ data: [sampleRow], count: 120 });

    const page = await queryInquiries({ from } as never, "game-1", DEFAULT_QUERY);

    expect(select).toHaveBeenCalledWith("*", { count: "exact" });
    expect(calls.eq).toEqual([["game_id", "game-1"]]);
    expect(calls.or).toEqual([]);
    expect(calls.order).toEqual([["created_at", { ascending: false }]]);
    expect(calls.range).toEqual([[0, 49]]);
    expect(page).toMatchObject({ total: 120, page: 1, pageSize: 50 });
    expect(page.rows[0].gameAccount).toBe("player1");
  });

  it("applies group, type, status filters and the page offset", async () => {
    const { from, calls } = mockBuilder({ data: [], count: 0 });

    await queryInquiries({ from } as never, "game-1", {
      ...DEFAULT_QUERY,
      group: "game_usage",
      type: "bug_report",
      status: "resolved",
      page: 3,
    });

    expect(calls.eq).toEqual([
      ["game_id", "game-1"],
      ["group_key", "game_usage"],
      ["type_key", "bug_report"],
      ["status", "resolved"],
    ]);
    expect(calls.range).toEqual([[100, 149]]);
  });

  it("searches title, number, account, and body with one or() filter", async () => {
    const { from, calls } = mockBuilder({ data: [], count: 0 });

    await queryInquiries({ from } as never, "game-1", { ...DEFAULT_QUERY, q: "환불" });

    expect(calls.or).toEqual([
      ["title.ilike.%환불%,inquiry_no.ilike.%환불%,game_account.ilike.%환불%,content.ilike.%환불%"],
    ]);
  });

  it("sorts oldest first and by priority rank", async () => {
    const oldest = mockBuilder({ data: [], count: 0 });
    await queryInquiries({ from: oldest.from } as never, "game-1", { ...DEFAULT_QUERY, sort: "oldest" });
    expect(oldest.calls.order).toEqual([["created_at", { ascending: true }]]);

    const priority = mockBuilder({ data: [], count: 0 });
    await queryInquiries({ from: priority.from } as never, "game-1", { ...DEFAULT_QUERY, sort: "priority" });
    expect(priority.calls.order).toEqual([
      ["priority_rank", { ascending: true }],
      ["created_at", { ascending: false }],
    ]);
  });

  it("throws when the query errors", async () => {
    const { from } = mockBuilder({ error: { message: "db down" } });
    await expect(queryInquiries({ from } as never, "game-1", DEFAULT_QUERY)).rejects.toThrow(/db down/);
  });

  it("filters by priority", async () => {
    const { from, calls } = mockBuilder({ data: [], count: 0 });
    await queryInquiries({ from } as never, "game-1", { ...DEFAULT_QUERY, priority: "urgent" });
    expect(calls.eq).toEqual([
      ["game_id", "game-1"],
      ["priority", "urgent"],
    ]);
  });

  it("stale means unresolved and older than 72 hours from the injected now", async () => {
    const { from, calls } = mockBuilder({ data: [], count: 0 });
    const now = new Date("2026-09-04T12:00:00.000Z");

    await queryInquiries({ from } as never, "game-1", { ...DEFAULT_QUERY, stale: true }, { now });

    expect(calls.neq).toEqual([["status", "resolved"]]);
    expect(calls.lt).toEqual([["created_at", "2026-09-01T12:00:00.000Z"]]);
  });

  it("does not add stale conditions by default", async () => {
    const { from, calls } = mockBuilder({ data: [], count: 0 });
    await queryInquiries({ from } as never, "game-1", DEFAULT_QUERY);
    expect(calls.neq).toEqual([]);
    expect(calls.lt).toEqual([]);
  });
});

describe("sanitizeSearch", () => {
  it("removes characters that would break the PostgREST or() syntax", () => {
    expect(sanitizeSearch("a,b(c)%d_e")).toBe("a b c d e");
    expect(sanitizeSearch("  결제   오류 ")).toBe("결제 오류");
  });
});

describe("listInquiryIds", () => {
  it("returns ids in the same order as the list, without paging", async () => {
    const { from, select, calls } = mockBuilder({ data: [{ id: "a" }, { id: "b" }] });

    const ids = await listInquiryIds({ from } as never, "game-1", { ...DEFAULT_QUERY, status: "new", page: 4 });

    expect(select).toHaveBeenCalledWith("id");
    expect(calls.eq).toEqual([
      ["game_id", "game-1"],
      ["status", "new"],
    ]);
    expect(calls.range).toEqual([]);
    expect(calls.limit).toEqual([[1000]]);
    expect(ids).toEqual(["a", "b"]);
  });

  it("returns an empty list on error", async () => {
    const { from } = mockBuilder({ error: { message: "x" } });
    await expect(listInquiryIds({ from } as never, "game-1", DEFAULT_QUERY)).resolves.toEqual([]);
  });

  it("accepts a custom limit and applies stale with the injected now", async () => {
    const { from, calls } = mockBuilder({ data: [] });
    await listInquiryIds({ from } as never, "game-1", { ...DEFAULT_QUERY, stale: true }, {
      limit: 10,
      now: new Date("2026-09-04T12:00:00.000Z"),
    });
    expect(calls.limit).toEqual([[10]]);
    expect(calls.lt).toEqual([["created_at", "2026-09-01T12:00:00.000Z"]]);
  });
});

describe("getInquiryFacetCounts", () => {
  it("calls the RPC and folds rows into a counts object", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { facet: "status", key: "new", count: 4 },
        { facet: "status", key: "in_progress", count: 7 },
        { facet: "type", key: "bug_report", count: 5 },
        { facet: "type", key: "payment_refund", count: 8 },
        { facet: "priority", key: "urgent", count: 1 },
        { facet: "priority", key: "high", count: 3 },
        { facet: "stale", key: "1", count: 2 },
        { facet: "total", key: "all", count: 23 },
      ],
      error: null,
    });

    const counts = await getInquiryFacetCounts({ rpc } as never, "game-1");

    expect(rpc).toHaveBeenCalledWith("inquiry_facet_counts", { p_game_id: "game-1" });
    expect(counts).toEqual({
      total: 23,
      status: { new: 4, in_progress: 7, resolved: 0 },
      type: { bug_report: 5, payment_refund: 8 },
      priority: { urgent: 1, high: 3, normal: 0, low: 0 },
      stale: 2,
    });
  });

  it("ignores unknown facets and keys and coerces bigint strings", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { facet: "status", key: "weird", count: "9" },
        { facet: "mystery", key: "x", count: 1 },
        { facet: "total", key: "all", count: "12" },
      ],
      error: null,
    });
    const counts = await getInquiryFacetCounts({ rpc } as never, "game-1");
    expect(counts?.total).toBe(12);
    expect(counts?.status).toEqual({ new: 0, in_progress: 0, resolved: 0 });
  });

  it("returns null when the RPC fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(getInquiryFacetCounts({ rpc } as never, "game-1")).resolves.toBeNull();
  });
});

describe("countInquiriesByGame", () => {
  it("asks for a head count", async () => {
    const eq = vi.fn().mockResolvedValue({ count: 7 });
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    await expect(countInquiriesByGame({ from } as never, "game-1")).resolves.toBe(7);
    expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(eq).toHaveBeenCalledWith("game_id", "game-1");
  });
});

describe("countNewInquiriesByGame", () => {
  it("tallies new inquiries per game", async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [{ game_id: "g1" }, { game_id: "g1" }, { game_id: "g2" }, { game_id: null }],
      error: null,
    });
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    await expect(countNewInquiriesByGame({ from } as never)).resolves.toEqual({ g1: 2, g2: 1 });
    expect(eq).toHaveBeenCalledWith("status", "new");
  });

  it("returns an empty map on error", async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: { message: "x" } });
    const from = vi.fn(() => ({ select: vi.fn(() => ({ eq })) }));
    await expect(countNewInquiriesByGame({ from } as never)).resolves.toEqual({});
  });
});

describe("getInquiryById", () => {
  it("returns null when the query errors", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await getInquiryById({ from } as never, "missing");
    expect(result).toBeNull();
  });

  it("maps a found row", async () => {
    const single = vi.fn().mockResolvedValue({ data: sampleRow, error: null });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await getInquiryById({ from } as never, "inq-1");
    expect(result?.status).toBe("new");
  });
});

describe("listAttachmentSignedUrls", () => {
  it("returns an empty array when there are no attachments", async () => {
    const eq = vi.fn().mockResolvedValue({ data: [], error: null });
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await listAttachmentSignedUrls({ from } as never, "inq-1");
    expect(result).toEqual([]);
  });

  it("signs a URL for each attachment", async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [{ id: "att-1", file_path: "inq-1/screenshot.png", file_name: "screenshot.png" }],
      error: null,
    });
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
    const storageFrom = vi.fn(() => ({ createSignedUrl }));

    const result = await listAttachmentSignedUrls({ from, storage: { from: storageFrom } } as never, "inq-1");
    expect(createSignedUrl).toHaveBeenCalledWith("inq-1/screenshot.png", 3600);
    expect(result).toEqual([{ id: "att-1", fileName: "screenshot.png", signedUrl: "https://signed.example/x" }]);
  });
});

describe("mapInquiryRow via getInquiryById", () => {
  function mockSingle(row: unknown) {
    const single = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    return { from: vi.fn(() => ({ select })) };
  }

  it("maps inquiry_no, priority, and meta", async () => {
    const result = await getInquiryById(mockSingle(sampleRow) as never, "inq-1");
    expect(result?.inquiryNo).toBe("R-20260101-0001");
    expect(result?.priority).toBe("high");
    expect(result?.meta).toEqual({ uid: "10024871" });
    expect(result?.draftReply).toBe("작성 중");
  });

  it("maps the per-type detail columns the contact form fills in", async () => {
    const result = await getInquiryById(
      mockSingle({ ...sampleRow, locale: "zh", payment_no: "imp_123", occurred_at: "2026-09-03T14:05", device_info: "iPhone 15 / iOS 17.5" }) as never,
      "inq-1"
    );
    expect(result?.locale).toBe("zh");
    expect(result?.paymentNo).toBe("imp_123");
    expect(result?.occurredAt).toBe("2026-09-03T14:05");
    expect(result?.deviceInfo).toBe("iPhone 15 / iOS 17.5");
  });

  it("leaves the detail columns null when the row predates them", async () => {
    const result = await getInquiryById(mockSingle(sampleRow) as never, "inq-1");
    expect(result?.locale).toBeNull();
    expect(result?.paymentNo).toBeNull();
    expect(result?.occurredAt).toBeNull();
    expect(result?.deviceInfo).toBeNull();
  });

  it("falls back when inquiry_no, priority, and meta are missing", async () => {
    const bare = { ...sampleRow, inquiry_no: null, priority: null, meta: null };
    const result = await getInquiryById(mockSingle(bare) as never, "inq-1");
    expect(result?.inquiryNo).toBeNull();
    expect(result?.priority).toBe("normal");
    expect(result?.meta).toEqual({});
  });
});
