import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE } from "@/app/api/games/[gameId]/route";
import * as supabaseModule from "@/lib/supabase";
import * as requireAdminSessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/require-admin-session", () => ({
  requireAdminSession: vi.fn(),
}));

interface MockOptions {
  game?: { id: string; logo_path: string | null } | null;
  inquiries?: Array<{ id: string }>;
  attachments?: Array<{ file_path: string }>;
  inquiriesDeleteError?: { message: string } | null;
  gameDeleteError?: { message: string } | null;
}

function mockSupabase(options: MockOptions = {}) {
  const {
    game = { id: "game-1", logo_path: null },
    inquiries = [],
    attachments = [],
    inquiriesDeleteError = null,
    gameDeleteError = null,
  } = options;

  const storageRemove = vi.fn().mockResolvedValue({ error: null });
  const inquiriesDelete = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: inquiriesDeleteError }) }));
  const gamesDelete = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: gameDeleteError }) }));

  const from = vi.fn((table: string) => {
    if (table === "games") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: game, error: game ? null : { message: "not found" } }),
          })),
        })),
        delete: gamesDelete,
      };
    }
    if (table === "inquiries") {
      return {
        select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: inquiries, error: null }) })),
        delete: inquiriesDelete,
      };
    }
    if (table === "inquiry_attachments") {
      return {
        select: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: attachments, error: null }) })),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  const client = { from, storage: { from: vi.fn(() => ({ remove: storageRemove })) } };
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue(client as never);
  return { from, storageRemove, inquiriesDelete, gamesDelete, storageFrom: client.storage.from };
}

function makeRequest() {
  return new Request("http://localhost/api/games/game-1", { method: "DELETE" });
}

describe("DELETE /api/games/[gameId]", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockResolvedValue(false);
    const response = await DELETE(makeRequest(), { params: { gameId: "game-1" } });
    expect(response.status).toBe(401);
  });

  it("returns 404 when the game does not exist", async () => {
    mockSupabase({ game: null });
    const response = await DELETE(makeRequest(), { params: { gameId: "game-1" } });
    expect(response.status).toBe(404);
  });

  it("deletes inquiries, the game, and storage files", async () => {
    const { storageRemove, inquiriesDelete, gamesDelete, storageFrom } = mockSupabase({
      game: { id: "game-1", logo_path: "game-1/logo.png" },
      inquiries: [{ id: "inq-1" }, { id: "inq-2" }],
      attachments: [{ file_path: "inq-1/file.png" }],
    });

    const response = await DELETE(makeRequest(), { params: { gameId: "game-1" } });
    const json = await response.json();

    expect(json).toEqual({ success: true });
    expect(inquiriesDelete).toHaveBeenCalled();
    expect(gamesDelete).toHaveBeenCalled();
    expect(storageFrom).toHaveBeenCalledWith("inquiry-attachments");
    expect(storageFrom).toHaveBeenCalledWith("game-logos");
    expect(storageRemove).toHaveBeenCalledWith(["inq-1/file.png"]);
    expect(storageRemove).toHaveBeenCalledWith(["game-1/logo.png"]);
  });

  it("skips storage cleanup when there is nothing to remove", async () => {
    const { storageRemove } = mockSupabase();
    const response = await DELETE(makeRequest(), { params: { gameId: "game-1" } });
    const json = await response.json();

    expect(json).toEqual({ success: true });
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("returns 500 and keeps the game when deleting inquiries fails", async () => {
    const { gamesDelete } = mockSupabase({ inquiriesDeleteError: { message: "boom" } });
    const response = await DELETE(makeRequest(), { params: { gameId: "game-1" } });

    expect(response.status).toBe(500);
    expect(gamesDelete).not.toHaveBeenCalled();
  });

  it("returns 500 when deleting the game fails", async () => {
    mockSupabase({ gameDeleteError: { message: "boom" } });
    const response = await DELETE(makeRequest(), { params: { gameId: "game-1" } });
    expect(response.status).toBe(500);
  });
});
