import { describe, it, expect, vi } from "vitest";
import { parseSourceUrl, sourceUrl, listSources, getSource, insertSource, deleteSource } from "@/lib/assistant-sources";

const row = { id: "s1", game_id: "g1", kind: "sheet", external_id: "1AbC-_9", title: "VIP 원장", created_at: "2026-09-07T00:00:00.000Z" };
const mapped = { id: "s1", gameId: "g1", kind: "sheet", externalId: "1AbC-_9", title: "VIP 원장", createdAt: "2026-09-07T00:00:00.000Z" };

describe("parseSourceUrl", () => {
  it("detects a spreadsheet url", () => {
    expect(parseSourceUrl("https://docs.google.com/spreadsheets/d/1AbC-_9/edit#gid=0")).toEqual({ kind: "sheet", externalId: "1AbC-_9" });
  });
  it("detects a document url", () => {
    expect(parseSourceUrl(" https://docs.google.com/document/d/1DoC_x/edit ")).toEqual({ kind: "doc", externalId: "1DoC_x" });
  });
  it("rejects bare ids, other urls, and empty input", () => {
    expect(parseSourceUrl("1AbC-_9")).toBeNull();
    expect(parseSourceUrl("https://example.com/spreadsheets/d/1AbC")).toBeNull();
    expect(parseSourceUrl("")).toBeNull();
  });
});

describe("sourceUrl", () => {
  it("builds the edit url per kind", () => {
    expect(sourceUrl({ kind: "sheet", externalId: "1AbC" })).toBe("https://docs.google.com/spreadsheets/d/1AbC/edit");
    expect(sourceUrl({ kind: "doc", externalId: "1DoC" })).toBe("https://docs.google.com/document/d/1DoC/edit");
  });
});

describe("store", () => {
  it("listSources orders by created_at and maps rows", async () => {
    const order = vi.fn().mockResolvedValue({ data: [row], error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const supabase = { from: vi.fn(() => ({ select })) } as never;

    expect(await listSources(supabase, "g1")).toEqual([mapped]);
    expect(eq).toHaveBeenCalledWith("game_id", "g1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
  });

  it("getSource returns null when missing", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const supabase = { from: vi.fn(() => ({ select })) } as never;
    expect(await getSource(supabase, "s1")).toBeNull();
  });

  it("insertSource returns the row, or 'duplicate' on a unique violation", async () => {
    const single = vi.fn().mockResolvedValueOnce({ data: row, error: null }).mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const supabase = { from: vi.fn(() => ({ insert })) } as never;
    const input = { gameId: "g1", kind: "sheet" as const, externalId: "1AbC-_9", title: "VIP 원장" };

    expect(await insertSource(supabase, input)).toEqual(mapped);
    expect(insert).toHaveBeenCalledWith({ game_id: "g1", kind: "sheet", external_id: "1AbC-_9", title: "VIP 원장" });
    expect(await insertSource(supabase, input)).toBe("duplicate");
  });

  it("deleteSource scopes the delete to the game and reports whether a row went away", async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: "s1" }], error: null });
    const eq2 = vi.fn(() => ({ select }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const del = vi.fn(() => ({ eq: eq1 }));
    const supabase = { from: vi.fn(() => ({ delete: del })) } as never;

    expect(await deleteSource(supabase, "g1", "s1")).toBe(true);
    expect(eq1).toHaveBeenCalledWith("id", "s1");
    expect(eq2).toHaveBeenCalledWith("game_id", "g1");

    select.mockResolvedValue({ data: [], error: null });
    expect(await deleteSource(supabase, "g1", "s1")).toBe(false);
  });
});
