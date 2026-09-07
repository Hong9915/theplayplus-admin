import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/games/[gameId]/sources/route";
import { DELETE } from "@/app/api/games/[gameId]/sources/[sourceId]/route";
import * as sessionModule from "@/lib/require-admin-session";
import * as sourcesModule from "@/lib/assistant-sources";
import * as sheetsModule from "@/lib/sheets";
import * as docsModule from "@/lib/docs";

const gamesSingleMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "games") {
        return { select: () => ({ eq: () => ({ maybeSingle: gamesSingleMock }) }) };
      }
      return {};
    }),
  })),
}));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn(), getAdminSession: vi.fn() }));
vi.mock("@/lib/assistant-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant-sources")>();
  return { ...actual, insertSource: vi.fn(), deleteSource: vi.fn() };
});
vi.mock("@/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sheets")>();
  return { ...actual, readSpreadsheetTitle: vi.fn() };
});
vi.mock("@/lib/docs", () => ({ readDocument: vi.fn() }));

const saved = { id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "1AbC", title: "VIP 원장", createdAt: "" };

function post(body: unknown) {
  return new Request("http://localhost/api/games/g1/sources", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/games/[gameId]/sources", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(sourcesModule.insertSource).mockReset().mockResolvedValue(saved);
    vi.mocked(sheetsModule.readSpreadsheetTitle).mockReset().mockResolvedValue("VIP 원장");
    vi.mocked(docsModule.readDocument).mockReset().mockResolvedValue({ title: "운영 가이드", text: "" });
    gamesSingleMock.mockReset().mockResolvedValue({ data: { id: "g1" }, error: null });
  });

  it("returns 404 for an unknown game without reading the title or saving", async () => {
    gamesSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await POST(post({ url: "https://docs.google.com/spreadsheets/d/1AbC/edit" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: "not_found" });
    expect(sheetsModule.readSpreadsheetTitle).not.toHaveBeenCalled();
    expect(sourcesModule.insertSource).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await POST(post({ url: "x" }), { params: { gameId: "g1" } })).status).toBe(401);
  });

  it("rejects a url that is not a sheet or doc", async () => {
    const response = await POST(post({ url: "1AbC" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "invalid_input" });
    expect(sourcesModule.insertSource).not.toHaveBeenCalled();
  });

  it("reads the sheet title and stores the source", async () => {
    const response = await POST(post({ url: "https://docs.google.com/spreadsheets/d/1AbC/edit" }), { params: { gameId: "g1" } });
    expect(await response.json()).toEqual({ success: true, source: saved });
    expect(sheetsModule.readSpreadsheetTitle).toHaveBeenCalledWith("1AbC");
    expect(sourcesModule.insertSource).toHaveBeenCalledWith(expect.anything(), { gameId: "g1", kind: "sheet", externalId: "1AbC", title: "VIP 원장" });
  });

  it("reads a document title for doc urls", async () => {
    await POST(post({ url: "https://docs.google.com/document/d/1DoC/edit" }), { params: { gameId: "g1" } });
    expect(docsModule.readDocument).toHaveBeenCalledWith("1DoC");
    expect(sourcesModule.insertSource).toHaveBeenCalledWith(expect.anything(), { gameId: "g1", kind: "doc", externalId: "1DoC", title: "운영 가이드" });
  });

  it("returns the read failure reason with 200 so the dialog can explain", async () => {
    vi.mocked(sheetsModule.readSpreadsheetTitle).mockRejectedValue(new sheetsModule.SheetError("source_forbidden"));
    const response = await POST(post({ url: "https://docs.google.com/spreadsheets/d/1AbC/edit" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: false, error: "source_forbidden" });
    expect(sourcesModule.insertSource).not.toHaveBeenCalled();
  });

  it("returns 409 duplicate", async () => {
    vi.mocked(sourcesModule.insertSource).mockResolvedValue("duplicate");
    const response = await POST(post({ url: "https://docs.google.com/spreadsheets/d/1AbC/edit" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: "duplicate" });
  });

  it("returns 500 when saving fails", async () => {
    vi.mocked(sourcesModule.insertSource).mockResolvedValue(null);
    const response = await POST(post({ url: "https://docs.google.com/spreadsheets/d/1AbC/edit" }), { params: { gameId: "g1" } });
    expect(response.status).toBe(500);
  });
});

describe("DELETE /api/games/[gameId]/sources/[sourceId]", () => {
  const req = () => new Request("http://localhost/x", { method: "DELETE" });

  beforeEach(() => {
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(sourcesModule.deleteSource).mockReset().mockResolvedValue(true);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    expect((await DELETE(req(), { params: { gameId: "g1", sourceId: "s1" } })).status).toBe(401);
  });

  it("deletes within the game", async () => {
    const response = await DELETE(req(), { params: { gameId: "g1", sourceId: "s1" } });
    expect(await response.json()).toEqual({ success: true });
    expect(sourcesModule.deleteSource).toHaveBeenCalledWith(expect.anything(), "g1", "s1");
  });

  it("returns 404 when nothing was deleted", async () => {
    vi.mocked(sourcesModule.deleteSource).mockResolvedValue(false);
    expect((await DELETE(req(), { params: { gameId: "g1", sourceId: "s1" } })).status).toBe(404);
  });
});
