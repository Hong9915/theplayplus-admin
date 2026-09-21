import { describe, it, expect, vi, beforeEach } from "vitest";

const { fetchLoungePosts } = vi.hoisted(() => ({ fetchLoungePosts: vi.fn() }));
vi.mock("@/lib/naver-lounge", async (original) => ({ ...(await original<typeof import("@/lib/naver-lounge")>()), fetchLoungePosts }));

import { connectLounge } from "@/lib/lounge-connect";

function fakeSupabase(current: string | null, updateError: unknown = null) {
  const calls = { updates: [] as unknown[], deletes: 0 };
  const client = {
    calls,
    from(table: string) {
      if (table === "games") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { naver_lounge_id: current }, error: null }) }) }),
          update: (patch: unknown) => (calls.updates.push(patch), { eq: () => Promise.resolve({ error: updateError }) }),
        };
      }
      return { delete: () => ({ eq: () => ((calls.deletes += 1), Promise.resolve({ error: null })) }) };
    },
  };
  return client;
}

beforeEach(() => fetchLoungePosts.mockReset().mockResolvedValue([]));

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
    const supabase = fakeSupabase(null, { message: "db" });
    expect(await connectLounge(supabase as never, "g1", "Abc")).toEqual({ ok: false, error: "save_failed" });
  });
});
