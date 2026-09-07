import { describe, it, expect, vi } from "vitest";
import { getInquiryFacetCounts, queryInquiries } from "@/lib/inquiries";
import { DEFAULT_QUERY } from "@/lib/inquiry-filters";
import { gameScope } from "@/lib/inbox-scope";

const baseRow = {
  id: "inq-1",
  inquiry_no: "R-1",
  game_id: "g1",
  group_key: "game_usage",
  type_key: "bug_report",
  game_account: "user#1",
  company_name: null,
  reply_email: "user@example.com",
  title: "제목",
  content: "본문",
  status: "new",
  priority: "normal",
  meta: {},
  draft_reply: null,
  reply_content: null,
  replied_at: null,
  gmail_thread_id: null,
  created_at: "2026-09-07T00:00:00.000Z",
};

/** supabase 빌더 흉내. 호출된 필터를 기록하고 마지막에 rows를 돌려준다. */
function fakeBuilder(rows: unknown[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const name of ["eq", "is", "neq", "lt", "not", "or", "order", "range", "limit"]) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve({ data: rows, error: null, count: rows.length });
  const from = vi.fn(() => ({ select: () => builder }));
  return { client: { from } as never, calls };
}

describe("queryInquiries", () => {
  it("maps unread_reply_at onto the row", async () => {
    const { client } = fakeBuilder([{ ...baseRow, unread_reply_at: "2026-09-07T01:00:00.000Z" }]);
    const page = await queryInquiries(client, gameScope("g1"), DEFAULT_QUERY);
    expect(page.rows[0].unreadReplyAt).toBe("2026-09-07T01:00:00.000Z");
  });

  it("filters to inquiries with an unread reply when unread is set", async () => {
    const { client, calls } = fakeBuilder([]);
    await queryInquiries(client, gameScope("g1"), { ...DEFAULT_QUERY, unread: true });
    expect(calls).toContainEqual(["not", "unread_reply_at", "is", null]);
  });

  it("does not add the unread condition by default", async () => {
    const { client, calls } = fakeBuilder([]);
    await queryInquiries(client, gameScope("g1"), DEFAULT_QUERY);
    expect(calls.find((call) => call[0] === "not")).toBeUndefined();
  });
});

describe("getInquiryFacetCounts", () => {
  it("reads the unread facet", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { facet: "total", key: "all", count: 3 },
        { facet: "unread", key: "1", count: "2" },
      ],
      error: null,
    });
    const counts = await getInquiryFacetCounts({ rpc } as never, gameScope("g1"));
    expect(counts?.unread).toBe(2);
    expect(counts?.total).toBe(3);
  });
});
