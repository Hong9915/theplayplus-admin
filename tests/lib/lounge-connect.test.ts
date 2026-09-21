import { describe, it, expect, vi, beforeEach } from "vitest";

const { fetchLoungePosts } = vi.hoisted(() => ({ fetchLoungePosts: vi.fn() }));
vi.mock("@/lib/naver-lounge", async (original) => ({ ...(await original<typeof import("@/lib/naver-lounge")>()), fetchLoungePosts }));

import { connectLounge } from "@/lib/lounge-connect";

interface FakeOptions {
  /** 현재 라운지 조회 실패 */
  selectError?: unknown;
  /** games 갱신 실패 */
  updateError?: unknown;
  /** 이전 라운지 항목 삭제 실패 */
  deleteError?: unknown;
}

function fakeSupabase(current: string | null, options: FakeOptions = {}) {
  const calls = { updates: [] as unknown[], deletes: 0 };
  const client = {
    calls,
    from(table: string) {
      if (table === "games") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: options.selectError ? null : { naver_lounge_id: current }, error: options.selectError ?? null }) }),
          }),
          update: (patch: unknown) => (calls.updates.push(patch), { eq: () => Promise.resolve({ error: options.updateError ?? null }) }),
        };
      }
      return { delete: () => ({ eq: () => ((calls.deletes += 1), Promise.resolve({ error: options.deleteError ?? null })) }) };
    },
  };
  return client;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchLoungePosts.mockReset().mockResolvedValue([]);
});

describe("connectLounge", () => {
  it("saves the id from a url, resets the watermark, and clears old items", async () => {
    const supabase = fakeSupabase("Old_Lounge");
    const result = await connectLounge(supabase as never, "g1", "https://game.naver.com/lounge/New_Lounge/home");
    expect(result).toEqual({ ok: true, loungeId: "New_Lounge" });
    expect(fetchLoungePosts).toHaveBeenCalledWith("New_Lounge");
    expect(supabase.calls.updates).toEqual([{ naver_lounge_id: "New_Lounge", lounge_synced_at: null }]);
    expect(supabase.calls.deletes).toBe(1);
  });

  it("does nothing when the same lounge is already connected", async () => {
    const supabase = fakeSupabase("Same");
    expect(await connectLounge(supabase as never, "g1", "Same")).toEqual({ ok: true, loungeId: "Same" });
    expect(supabase.calls.updates).toEqual([]);
    expect(supabase.calls.deletes).toBe(0);
  });

  it("disconnects on empty input", async () => {
    const supabase = fakeSupabase("Old");
    expect(await connectLounge(supabase as never, "g1", "  ")).toEqual({ ok: true, loungeId: null });
    expect(supabase.calls.updates).toEqual([{ naver_lounge_id: null, lounge_synced_at: null }]);
    expect(supabase.calls.deletes).toBe(1);
    expect(fetchLoungePosts).not.toHaveBeenCalled();
  });

  it("rejects junk and unreachable lounges without saving", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const supabase = fakeSupabase(null);
      expect(await connectLounge(supabase as never, "g1", "https://example.com/x")).toEqual({ ok: false, error: "invalid_lounge" });
      fetchLoungePosts.mockRejectedValueOnce(new Error("404"));
      expect(await connectLounge(supabase as never, "g1", "Nope")).toEqual({ ok: false, error: "lounge_unreachable" });
      expect(supabase.calls.updates).toEqual([]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("reports save_failed when the update fails", async () => {
    const supabase = fakeSupabase(null, { updateError: { message: "db" } });
    expect(await connectLounge(supabase as never, "g1", "Abc")).toEqual({ ok: false, error: "save_failed" });
  });

  it("reports save_failed when the current lounge cannot be read — a disconnect must not look like success", async () => {
    const supabase = fakeSupabase("Old", { selectError: { message: "db" } });
    expect(await connectLounge(supabase as never, "g1", "   ")).toEqual({ ok: false, error: "save_failed" });
    expect(supabase.calls.updates).toEqual([]);
    expect(supabase.calls.deletes).toBe(0);
  });

  it("keeps the old lounge connected when clearing its items fails", async () => {
    const supabase = fakeSupabase("Old_Lounge", { deleteError: { message: "db" } });
    expect(await connectLounge(supabase as never, "g1", "New_Lounge")).toEqual({ ok: false, error: "save_failed" });
    expect(supabase.calls.deletes).toBe(1);
    expect(supabase.calls.updates).toEqual([]);
  });
});
