import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST, maxDuration } from "@/app/api/policies/sync/route";
import * as supabaseModule from "@/lib/supabase";
import * as policiesModule from "@/lib/policies";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/policies", () => ({ syncAllPolicies: vi.fn() }));

function makeRequest(secret = "s3cret") {
  return new Request("https://admin.example/api/policies/sync", { method: "POST", headers: { "x-webhook-secret": secret }, body: "{}" });
}

describe("POST /api/policies/sync", () => {
  beforeEach(() => {
    vi.stubEnv("INQUIRY_WEBHOOK_SECRET", "s3cret");
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(policiesModule.syncAllPolicies).mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a wrong secret without syncing", async () => {
    const response = await POST(makeRequest("nope"));
    expect(response.status).toBe(401);
    expect(policiesModule.syncAllPolicies).not.toHaveBeenCalled();
  });

  it("declares a 60-second budget for the first full embedding run", () => {
    expect(maxDuration).toBe(60);
  });

  it("returns the per-game results", async () => {
    const results = [{ gameId: "g1", posts: 5, embedded: 2, removed: 0 }];
    vi.mocked(policiesModule.syncAllPolicies).mockResolvedValue(results);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, results });
  });

  it("treats a run cut short by the time budget as success", async () => {
    vi.mocked(policiesModule.syncAllPolicies).mockResolvedValue([{ gameId: "g1", posts: 5, embedded: 3, removed: 0, error: "incomplete" }]);
    expect((await POST(makeRequest())).status).toBe(200);
  });

  it("returns 502 when every game failed", async () => {
    vi.mocked(policiesModule.syncAllPolicies).mockResolvedValue([
      { gameId: "g1", posts: 0, embedded: 0, removed: 0, error: "fetch_failed" },
      { gameId: "g2", posts: 3, embedded: 0, removed: 0, error: "embed_failed" },
    ]);
    const response = await POST(makeRequest());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: "sync_failed" });
  });
});
