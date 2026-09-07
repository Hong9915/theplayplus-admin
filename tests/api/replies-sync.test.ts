import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/replies/sync/route";
import * as supabaseModule from "@/lib/supabase";
import * as replySyncModule from "@/lib/reply-sync";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/reply-sync", () => ({ syncAllMailboxes: vi.fn() }));

function makeRequest(secret: string | null = "s3cret") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["x-webhook-secret"] = secret;
  return new Request("https://admin.theplayplus.com/api/replies/sync", { method: "POST", headers, body: "{}" });
}

describe("POST /api/replies/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INQUIRY_WEBHOOK_SECRET", "s3cret");
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({} as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a missing or wrong secret", async () => {
    expect((await POST(makeRequest(null))).status).toBe(401);
    expect((await POST(makeRequest("wrong"))).status).toBe(401);
    expect(replySyncModule.syncAllMailboxes).not.toHaveBeenCalled();
  });

  it("syncs every mailbox and reports the results", async () => {
    vi.mocked(replySyncModule.syncAllMailboxes).mockResolvedValue([
      { mailbox: "game", fetched: 3, matched: 1, added: 1 },
      { mailbox: "service", fetched: 0, matched: 0, added: 0 },
    ]);

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      results: [
        { mailbox: "game", fetched: 3, matched: 1, added: 1 },
        { mailbox: "service", fetched: 0, matched: 0, added: 0 },
      ],
    });
  });

  it("answers 502 when every mailbox failed", async () => {
    vi.mocked(replySyncModule.syncAllMailboxes).mockResolvedValue([
      { mailbox: "game", fetched: 0, matched: 0, added: 0, error: "fetch_failed" },
    ]);

    const response = await POST(makeRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      success: false,
      error: "sync_failed",
      results: [{ mailbox: "game", fetched: 0, matched: 0, added: 0, error: "fetch_failed" }],
    });
  });
});
