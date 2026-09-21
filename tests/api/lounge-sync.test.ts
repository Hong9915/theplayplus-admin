import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST, maxDuration } from "@/app/api/lounge/sync/route";
import * as supabaseModule from "@/lib/supabase";
import * as syncModule from "@/lib/lounge-sync";
import * as slackModule from "@/lib/slack";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/lounge-sync", () => ({ syncAllLounges: vi.fn() }));
vi.mock("@/lib/slack", () => ({ buildLoungeSlackMessage: vi.fn(() => ({ text: "t", attachments: [] })), sendSlackMessage: vi.fn() }));

const item = { id: "i1", gameId: "g1", kind: "post", naverId: 100, feedId: 100, title: "글", body: "", boardName: null, nickname: null, isUser: true, url: "u", postedAt: "2026-09-21T09:57:00.000Z", readAt: null };

type SyncResult = Awaited<ReturnType<typeof syncModule.syncAllLounges>>[number];

/** 진짜 syncAllLounges처럼 게임 하나가 끝날 때마다 onGameSynced를 부르고 전체 결과를 돌려준다. */
function mockSync(results: SyncResult[], afterEachGame?: () => void) {
  vi.mocked(syncModule.syncAllLounges).mockImplementation(async (_supabase, options) => {
    for (const result of results) {
      await options?.onGameSynced?.(result);
      afterEachGame?.();
    }
    return results;
  });
}

function makeRequest(secret = "s3cret") {
  return new Request("https://admin.example/api/lounge/sync", { method: "POST", headers: { "x-webhook-secret": secret }, body: "{}" });
}

describe("POST /api/lounge/sync", () => {
  beforeEach(() => {
    vi.stubEnv("INQUIRY_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.example/x");
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(syncModule.syncAllLounges).mockReset();
    vi.mocked(slackModule.sendSlackMessage).mockReset().mockResolvedValue();
    vi.mocked(slackModule.buildLoungeSlackMessage).mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a wrong secret without syncing", async () => {
    const response = await POST(makeRequest("nope"));
    expect(response.status).toBe(401);
    expect(syncModule.syncAllLounges).not.toHaveBeenCalled();
  });

  it("declares a 60-second budget so the platform does not kill a long sync", () => {
    expect(maxDuration).toBe(60);
  });

  it("syncs, sends one Slack message per game with new items, and reports counts", async () => {
    mockSync([
      { gameId: "g1", gameName: "갓생 토크", fetched: 8, added: [item as never] },
      { gameId: "g2", gameName: "둘째", fetched: 3, added: [] },
    ]);
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      results: [{ gameId: "g1", fetched: 8, added: 1 }, { gameId: "g2", fetched: 3, added: 0 }],
      notified: 1,
    });
    expect(slackModule.buildLoungeSlackMessage).toHaveBeenCalledWith({ gameName: "갓생 토크", items: [item], listUrl: "https://admin.example/games/g1/lounge" });
    expect(slackModule.sendSlackMessage).toHaveBeenCalledTimes(1);
  });

  it("sends each game's Slack message as that game finishes, not after the whole sync", async () => {
    const sentSoFar: number[] = [];
    mockSync(
      [
        { gameId: "g1", gameName: "갓생 토크", fetched: 8, added: [item as never] },
        { gameId: "g2", gameName: "둘째", fetched: 3, added: [{ ...item, id: "i2", gameId: "g2" } as never] },
      ],
      () => sentSoFar.push(vi.mocked(slackModule.sendSlackMessage).mock.calls.length)
    );
    expect((await POST(makeRequest())).status).toBe(200);
    expect(sentSoFar).toEqual([1, 2]);
  });

  it("still reports 200 and alerts the healthy game when another game failed", async () => {
    mockSync([
      { gameId: "g1", gameName: "갓생 토크", fetched: 0, added: [], error: "fetch_failed" },
      { gameId: "g2", gameName: "둘째", fetched: 3, added: [{ ...item, id: "i2", gameId: "g2" } as never] },
    ]);
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      results: [{ gameId: "g1", fetched: 0, added: 0, error: "fetch_failed" }, { gameId: "g2", fetched: 3, added: 1 }],
      notified: 1,
    });
    expect(slackModule.buildLoungeSlackMessage).toHaveBeenCalledWith(expect.objectContaining({ gameName: "둘째", listUrl: "https://admin.example/games/g2/lounge" }));
  });

  it("skips Slack quietly when the webhook url is missing", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    mockSync([{ gameId: "g1", gameName: "갓생 토크", fetched: 8, added: [item as never] }]);
    const json = await (await POST(makeRequest())).json();
    expect(json.notified).toBe(0);
    expect(slackModule.sendSlackMessage).not.toHaveBeenCalled();
  });

  it("still succeeds when Slack fails — the items are already stored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(slackModule.sendSlackMessage).mockRejectedValueOnce(new Error("slack down"));
    mockSync([{ gameId: "g1", gameName: "갓생 토크", fetched: 8, added: [item as never] }]);
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).notified).toBe(0);
    vi.restoreAllMocks();
  });

  it("returns 502 when every lounge failed", async () => {
    mockSync([{ gameId: "g1", gameName: "갓생 토크", fetched: 0, added: [], error: "fetch_failed" }]);
    const response = await POST(makeRequest());
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("sync_failed");
  });
});
