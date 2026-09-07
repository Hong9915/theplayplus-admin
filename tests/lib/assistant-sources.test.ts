import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSourceUrl, sourceUrl, listSources, getSource, insertSource, deleteSource, loadSources, serializeSources, type LoadedSource } from "@/lib/assistant-sources";
import * as sheetsModule from "@/lib/sheets";
import * as docsModule from "@/lib/docs";

vi.mock("@/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheets")>();
  return { ...actual, readSpreadsheet: vi.fn() };
});
vi.mock("@/lib/docs", () => ({ readDocument: vi.fn() }));

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

const sheetSource = { id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "sh1", title: "VIP 원장", createdAt: "" };
const docSource = { id: "s2", gameId: "g1", kind: "doc" as const, externalId: "dc1", title: "운영 가이드", createdAt: "" };
const tabs = [{ title: "VIP", header: ["이메일", "VIP 단계"], rows: [["이메일", "VIP 단계"], ["a@x.com", "VIP3"]] }];

describe("loadSources", () => {
  beforeEach(() => {
    vi.mocked(sheetsModule.readSpreadsheet).mockReset().mockResolvedValue(tabs);
    vi.mocked(docsModule.readDocument).mockReset().mockResolvedValue({ title: "운영 가이드", text: "환불은 7일" });
  });

  it("reads every source in parallel and keeps their order", async () => {
    const loaded = await loadSources([sheetSource, docSource]);
    expect(loaded).toEqual([
      { source: sheetSource, kind: "sheet", tabs },
      { source: docSource, kind: "doc", text: "환불은 7일" },
    ]);
    expect(sheetsModule.readSpreadsheet).toHaveBeenCalledWith("sh1");
    expect(docsModule.readDocument).toHaveBeenCalledWith("dc1");
  });

  it("tags a failure with the source title", async () => {
    vi.mocked(docsModule.readDocument).mockRejectedValue(new sheetsModule.SheetError("source_forbidden"));
    await expect(loadSources([sheetSource, docSource])).rejects.toMatchObject({ reason: "source_forbidden", sourceTitle: "운영 가이드" });
  });

  it("throws sources_too_large when the combined text passes the cap", async () => {
    vi.mocked(docsModule.readDocument).mockResolvedValue({ title: "운영 가이드", text: "x".repeat(sheetsModule.MAX_SHEET_CHARS) });
    await expect(loadSources([sheetSource, docSource])).rejects.toMatchObject({ reason: "sources_too_large" });
  });
});

describe("serializeSources", () => {
  it("wraps each source in a titled section", () => {
    const loaded: LoadedSource[] = [
      { source: sheetSource, kind: "sheet", tabs },
      { source: docSource, kind: "doc", text: "환불은 7일" },
    ];
    expect(serializeSources(loaded)).toBe(
      ["# 시트: VIP 원장", "", "## VIP", "행 | 이메일 | VIP 단계", "2 | a@x.com | VIP3", "", "", "# 문서: 운영 가이드", "", "환불은 7일"].join("\n")
    );
  });
});
