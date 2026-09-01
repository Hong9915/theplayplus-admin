import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/games/route";
import * as supabaseModule from "@/lib/supabase";
import * as categoriesModule from "@/lib/categories";
import * as requireAdminSessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/categories", () => ({
  createDefaultCategoriesForGame: vi.fn(),
}));

vi.mock("@/lib/require-admin-session", () => ({
  requireAdminSession: vi.fn(),
}));

function buildFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const base = { name: "여신키우기", status: "active", ownerName: "홍길동" };
  const merged = { ...base, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    fd.set(key, value);
  }
  return fd;
}

function mockSupabaseSuccess() {
  const single = vi.fn().mockResolvedValue({ data: { id: "game-1", created_at: "2026-01-01T00:00:00.000Z" }, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  const from = vi.fn().mockReturnValue({ insert, update });
  const upload = vi.fn().mockResolvedValue({ error: null });
  const storageFrom = vi.fn().mockReturnValue({ upload });
  const client = { from, storage: { from: storageFrom } };
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue(client as never);
  return client;
}

describe("POST /api/games", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
    vi.mocked(categoriesModule.createDefaultCategoriesForGame).mockReset().mockResolvedValue(undefined);
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockResolvedValue(false);
    mockSupabaseSuccess();

    const request = new Request("http://localhost/api/games", { method: "POST", body: buildFormData() });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ success: false, error: "unauthorized" });
  });

  it("deletes the game and returns category_seed_failed when category seeding throws", async () => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq });
    const single = vi.fn().mockResolvedValue({ data: { id: "game-1" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert, delete: deleteFn });
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from, storage: { from: vi.fn() } } as never);
    vi.mocked(categoriesModule.createDefaultCategoriesForGame).mockRejectedValue(new Error("seed failed"));

    const request = new Request("http://localhost/api/games", { method: "POST", body: buildFormData() });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({ success: false, error: "category_seed_failed" });
    expect(deleteFn).toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalledWith("id", "game-1");
  });

  it("creates a game and seeds default categories", async () => {
    mockSupabaseSuccess();
    const request = new Request("http://localhost/api/games", { method: "POST", body: buildFormData() });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      success: true,
      game: {
        id: "game-1",
        name: "여신키우기",
        status: "active",
        logoPath: null,
        ownerName: "홍길동",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(categoriesModule.createDefaultCategoriesForGame).toHaveBeenCalledWith(expect.anything(), "game-1");
  });

  it("rejects a missing name", async () => {
    mockSupabaseSuccess();
    const request = new Request("http://localhost/api/games", {
      method: "POST",
      body: buildFormData({ name: "" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 500 when the game insert fails", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from, storage: { from: vi.fn() } } as never);

    const request = new Request("http://localhost/api/games", { method: "POST", body: buildFormData() });
    const response = await POST(request);
    expect(response.status).toBe(500);
  });

  it("deletes the game and returns logo_upload_failed when logo upload fails", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "game-1", created_at: "2026-01-01T00:00:00.000Z" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq });
    const from = vi.fn().mockReturnValue({ insert, delete: deleteFn });
    const upload = vi.fn().mockResolvedValue({ error: { message: "storage error" } });
    const storageFrom = vi.fn().mockReturnValue({ upload });
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from, storage: { from: storageFrom } } as never);

    const fd = buildFormData();
    fd.set("logo", new File(["fake image bytes"], "logo.png", { type: "image/png" }));

    const request = new Request("http://localhost/api/games", { method: "POST", body: fd });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({ success: false, error: "logo_upload_failed" });
    expect(deleteFn).toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalledWith("id", "game-1");
    expect(categoriesModule.createDefaultCategoriesForGame).not.toHaveBeenCalled();
  });
});
