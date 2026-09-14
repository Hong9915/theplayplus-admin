import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/games/route";
import * as supabaseModule from "@/lib/supabase";
import * as categoriesModule from "@/lib/categories";
import * as defaultTemplatesModule from "@/lib/default-templates";
import * as requireAdminSessionModule from "@/lib/require-admin-session";
import * as opsDocModule from "@/lib/ops-doc";
import * as sourcesModule from "@/lib/assistant-sources";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/categories", () => ({
  createDefaultCategoriesForGame: vi.fn(),
}));

vi.mock("@/lib/default-templates", () => ({
  createDefaultTemplatesForGame: vi.fn(),
}));

vi.mock("@/lib/require-admin-session", () => ({
  getAdminSession: vi.fn(),
}));

vi.mock("@/lib/ops-doc", () => ({
  createOpsDoc: vi.fn(),
  opsDocEditors: vi.fn(),
  isOpsDocConfigured: vi.fn(),
}));

vi.mock("@/lib/assistant-sources", () => ({
  insertSource: vi.fn(),
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
    vi.mocked(defaultTemplatesModule.createDefaultTemplatesForGame).mockReset().mockResolvedValue(undefined);
    vi.mocked(requireAdminSessionModule.getAdminSession).mockReset().mockResolvedValue({ id: "u-1", email: "admin@theplayplus.com" });
    vi.mocked(opsDocModule.isOpsDocConfigured).mockReset().mockReturnValue(true);
    vi.mocked(opsDocModule.opsDocEditors).mockReset().mockReturnValue(["admin@theplayplus.com"]);
    vi.mocked(opsDocModule.createOpsDoc)
      .mockReset()
      .mockResolvedValue({ docId: "doc-1", title: "여신키우기 운영 현황 (AI 답변 근거)", url: "https://docs.google.com/document/d/doc-1/edit", unshared: [] });
    vi.mocked(sourcesModule.insertSource).mockReset().mockResolvedValue({ id: "src-1" } as never);
  });

  it("creates the ops doc shared with the creator and registers it as a doc source", async () => {
    mockSupabaseSuccess();
    const request = new Request("http://localhost/api/games", { method: "POST", body: buildFormData() });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.warning).toBeUndefined();
    expect(opsDocModule.opsDocEditors).toHaveBeenCalledWith("admin@theplayplus.com");
    expect(opsDocModule.createOpsDoc).toHaveBeenCalledWith({ gameName: "여신키우기", editors: ["admin@theplayplus.com"] });
    expect(sourcesModule.insertSource).toHaveBeenCalledWith(expect.anything(), {
      gameId: "game-1",
      kind: "doc",
      externalId: "doc-1",
      title: "여신키우기 운영 현황 (AI 답변 근거)",
    });
  });

  it("warns ops_doc_not_configured without calling Google when the docs token is missing", async () => {
    mockSupabaseSuccess();
    vi.mocked(opsDocModule.isOpsDocConfigured).mockReturnValue(false);

    const json = await (await POST(new Request("http://localhost/api/games", { method: "POST", body: buildFormData() }))).json();

    expect(json.success).toBe(true);
    expect(json.warning).toBe("ops_doc_not_configured");
    expect(opsDocModule.createOpsDoc).not.toHaveBeenCalled();
  });

  it("keeps the game and warns ops_doc_failed when the doc cannot be created", async () => {
    mockSupabaseSuccess();
    vi.mocked(opsDocModule.createOpsDoc).mockRejectedValue(new Error("drive down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(new Request("http://localhost/api/games", { method: "POST", body: buildFormData() }));
    const json = await response.json();

    expect(json.success).toBe(true);
    expect(json.warning).toBe("ops_doc_failed");
    expect(sourcesModule.insertSource).not.toHaveBeenCalled();
  });

  it("warns ops_doc_failed when the doc was made but could not be registered as a source", async () => {
    mockSupabaseSuccess();
    vi.mocked(sourcesModule.insertSource).mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const json = await (await POST(new Request("http://localhost/api/games", { method: "POST", body: buildFormData() }))).json();

    expect(json.warning).toBe("ops_doc_failed");
  });

  it("seeds the default auto reply templates after the categories", async () => {
    mockSupabaseSuccess();
    const request = new Request("http://localhost/api/games", { method: "POST", body: buildFormData() });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(defaultTemplatesModule.createDefaultTemplatesForGame).toHaveBeenCalledWith(expect.anything(), "game-1");
  });

  it("keeps the game and warns when template seeding fails", async () => {
    mockSupabaseSuccess();
    vi.mocked(defaultTemplatesModule.createDefaultTemplatesForGame).mockRejectedValue(new Error("seed failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const request = new Request("http://localhost/api/games", { method: "POST", body: buildFormData() });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.warning).toBe("template_seed_failed");
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(requireAdminSessionModule.getAdminSession).mockResolvedValue(null);
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

  it("keeps the game and warns instead of rolling back when logo upload fails", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "game-1", created_at: "2026-01-01T00:00:00.000Z" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq });
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const from = vi.fn().mockReturnValue({ insert, update, delete: deleteFn });
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
    expect(json.warning).toBe("logo_upload_failed");
    expect(json.game.logoPath).toBeNull();
    // A failed logo upload is a best-effort side task; the game must survive it.
    expect(deleteFn).not.toHaveBeenCalled();
    expect(categoriesModule.createDefaultCategoriesForGame).toHaveBeenCalledWith(expect.anything(), "game-1");
  });

  it("uploads the logo under an ascii-safe key even for a korean filename", async () => {
    const client = mockSupabaseSuccess();
    const upload = vi.mocked(client.storage.from("game-logos").upload);

    const fd = buildFormData();
    fd.set("logo", new File(["fake image bytes"], "여신로고.png", { type: "image/png" }));

    const request = new Request("http://localhost/api/games", { method: "POST", body: fd });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    const [key] = upload.mock.calls[0];
    expect(key).toMatch(/^game-1\/[A-Za-z0-9-]+-logo\.png$/);
    expect(json.game.logoPath).toBe(key);
    expect(json.warning).toBeUndefined();
  });
});
