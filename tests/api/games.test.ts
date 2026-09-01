import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/games/route";
import * as supabaseModule from "@/lib/supabase";
import * as categoriesModule from "@/lib/categories";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/categories", () => ({
  createDefaultCategoriesForGame: vi.fn(),
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
  const single = vi.fn().mockResolvedValue({ data: { id: "game-1" }, error: null });
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
  });

  it("creates a game and seeds default categories", async () => {
    mockSupabaseSuccess();
    const request = new Request("http://localhost/api/games", { method: "POST", body: buildFormData() });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true, id: "game-1" });
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

  it("saves the game even if logo upload fails, reporting a warning", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "game-1" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    const upload = vi.fn().mockResolvedValue({ error: { message: "storage error" } });
    const storageFrom = vi.fn().mockReturnValue({ upload });
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from, storage: { from: storageFrom } } as never);

    const fd = buildFormData();
    fd.set("logo", new File(["fake image bytes"], "logo.png", { type: "image/png" }));

    const request = new Request("http://localhost/api/games", { method: "POST", body: fd });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.logoWarning).toBe("logo.png");
  });
});
