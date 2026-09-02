import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createClientMock = vi.fn().mockReturnValue({ marker: "fake-client" });

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

describe("getSupabaseServerClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockClear();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when environment variables are missing", async () => {
    delete process.env.SUPABASE_URL;
    const { getSupabaseServerClient } = await import("@/lib/supabase");
    expect(() => getSupabaseServerClient()).toThrow(/SUPABASE_URL/);
  });

  it("creates a client using the configured credentials", async () => {
    const { getSupabaseServerClient } = await import("@/lib/supabase");
    getSupabaseServerClient();
    expect(createClientMock).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-key",
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) })
    );
  });

  it("forces no-store on every request so Next.js never serves stale data", async () => {
    const { getSupabaseServerClient } = await import("@/lib/supabase");
    getSupabaseServerClient();

    const options = createClientMock.mock.calls[0][2] as {
      global?: { fetch?: (input: RequestInfo, init?: RequestInit) => unknown };
    };
    expect(options.global?.fetch).toBeTypeOf("function");

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    options.global!.fetch!("https://example.supabase.co/rest/v1/games", { method: "GET" });
    vi.unstubAllGlobals();

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/games",
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
  });

  it("caches the client across calls", async () => {
    const { getSupabaseServerClient } = await import("@/lib/supabase");
    const first = getSupabaseServerClient();
    const second = getSupabaseServerClient();
    expect(first).toBe(second);
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });
});
