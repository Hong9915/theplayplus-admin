import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/notify/inquiry/route";
import * as supabaseModule from "@/lib/supabase";
import * as categoriesModule from "@/lib/categories";
import * as slackModule from "@/lib/slack";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/categories", () => ({ listCategoryLabelsForScope: vi.fn() }));
vi.mock("@/lib/slack", async () => {
  const actual = await vi.importActual<typeof import("@/lib/slack")>("@/lib/slack");
  return { ...actual, sendSlackMessage: vi.fn() };
});

const record = {
  id: "inq-1",
  inquiry_no: "20260903-0001",
  game_id: "game-1",
  group_key: "payment",
  type_key: "payment_error",
  game_account: "player#1",
  title: "결제 오류입니다",
  priority: "urgent",
};

function mockSupabase(game: { name: string } | null = { name: "여신의 검" }) {
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: game, error: game ? null : { message: "not found" } }),
        })),
      })),
    })),
  };
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue(client as never);
  return client;
}

function makeRequest(body: unknown, secret: string | null = "s3cret") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) {
    headers["x-webhook-secret"] = secret;
  }
  return new Request("https://admin.theplayplus.com/api/notify/inquiry", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const insertPayload = { type: "INSERT", table: "inquiries", record };

describe("POST /api/notify/inquiry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INQUIRY_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/x");
    mockSupabase();
    vi.mocked(categoriesModule.listCategoryLabelsForScope).mockResolvedValue({
      groupLabels: { payment: "결제" },
      typeLabels: { payment_error: "결제 오류" },
      typeOrder: ["payment_error"],
    });
    vi.mocked(slackModule.sendSlackMessage).mockResolvedValue();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects requests without the shared secret", async () => {
    const response = await POST(makeRequest(insertPayload, null));
    expect(response.status).toBe(401);
    expect(slackModule.sendSlackMessage).not.toHaveBeenCalled();
  });

  it("rejects requests with a wrong secret", async () => {
    const response = await POST(makeRequest(insertPayload, "wrong"));
    expect(response.status).toBe(401);
  });

  it("rejects when the server has no secret configured", async () => {
    vi.stubEnv("INQUIRY_WEBHOOK_SECRET", "");
    const response = await POST(makeRequest(insertPayload, ""));
    expect(response.status).toBe(401);
  });

  it("ignores payloads that are not an inquiries insert", async () => {
    const response = await POST(makeRequest({ type: "UPDATE", table: "inquiries", record }));
    expect(response.status).toBe(400);
    expect(slackModule.sendSlackMessage).not.toHaveBeenCalled();
  });

  it("sends a Slack message with game name, labels and a detail link built from the request origin", async () => {
    const response = await POST(makeRequest(insertPayload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, notified: true });
    expect(slackModule.sendSlackMessage).toHaveBeenCalledTimes(1);
    const [url, message] = vi.mocked(slackModule.sendSlackMessage).mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/x");
    expect(message.text).toBe("[여신의 검] 새 문의 · 결제 > 결제 오류 · 결제 오류입니다");
    expect(JSON.stringify(message.blocks)).toContain("https://admin.theplayplus.com/games/game-1/inquiries/inq-1");
    expect(JSON.stringify(message.blocks)).toContain("20260903-0001");
  });

  it("falls back to raw keys and a placeholder game name when lookups fail", async () => {
    mockSupabase(null);
    vi.mocked(categoriesModule.listCategoryLabelsForScope).mockResolvedValue({ groupLabels: {}, typeLabels: {}, typeOrder: [] });

    await POST(makeRequest(insertPayload));

    const [, message] = vi.mocked(slackModule.sendSlackMessage).mock.calls[0];
    expect(message.text).toBe("[알 수 없는 게임] 새 문의 · payment > payment_error · 결제 오류입니다");
  });

  it("skips Slack and reports notified=false when no webhook url is configured", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    const response = await POST(makeRequest(insertPayload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, notified: false });
    expect(slackModule.sendSlackMessage).not.toHaveBeenCalled();
  });

  it("returns 502 when Slack rejects the message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(slackModule.sendSlackMessage).mockRejectedValue(new Error("Slack webhook failed: 400"));
    const response = await POST(makeRequest(insertPayload));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ success: false, error: "slack_failed" });
  });

  it("notifies service inquiries (game_id null) with a service label and a /service link", async () => {
    vi.mocked(categoriesModule.listCategoryLabelsForScope).mockResolvedValue({
      groupLabels: { business: "사업 제휴 문의" },
      typeLabels: { publishing: "퍼블리싱 제휴" },
      typeOrder: ["publishing"],
    });
    const client = mockSupabase();

    const response = await POST(
      makeRequest({
        type: "INSERT",
        table: "inquiries",
        record: { ...record, game_id: null, group_key: "business", type_key: "publishing", game_account: null, title: "퍼블리싱 제안" },
      })
    );

    expect(response.status).toBe(200);
    expect(client.from).not.toHaveBeenCalledWith("games");
    expect(categoriesModule.listCategoryLabelsForScope).toHaveBeenCalledWith(expect.anything(), { kind: "service" });
    const [, message] = vi.mocked(slackModule.sendSlackMessage).mock.calls[0];
    expect(message.text).toBe("[서비스 문의] 새 문의 · 사업 제휴 문의 > 퍼블리싱 제휴 · 퍼블리싱 제안");
    expect(JSON.stringify(message.blocks)).toContain("https://admin.theplayplus.com/service/inquiries/inq-1");
  });

  it("skips game inquiries that are not urgent", async () => {
    const response = await POST(
      makeRequest({ type: "INSERT", table: "inquiries", record: { ...record, priority: "normal" } })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, notified: false, skipped: "not_urgent" });
    expect(slackModule.sendSlackMessage).not.toHaveBeenCalled();
  });

  it("skips game inquiries whose payload has no priority", async () => {
    const { priority: _omitted, ...withoutPriority } = record;
    const response = await POST(makeRequest({ type: "INSERT", table: "inquiries", record: withoutPriority }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, notified: false, skipped: "not_urgent" });
    expect(slackModule.sendSlackMessage).not.toHaveBeenCalled();
  });

  it("notifies service inquiries regardless of priority", async () => {
    vi.mocked(categoriesModule.listCategoryLabelsForScope).mockResolvedValue({
      groupLabels: { business: "사업 제휴 문의" },
      typeLabels: { publishing: "퍼블리싱 제휴" },
      typeOrder: ["publishing"],
    });

    const response = await POST(
      makeRequest({
        type: "INSERT",
        table: "inquiries",
        record: { ...record, game_id: null, group_key: "business", type_key: "publishing", priority: "normal" },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, notified: true });
    expect(slackModule.sendSlackMessage).toHaveBeenCalledTimes(1);
  });

  it("still accepts payloads that omit game_id entirely", async () => {
    const { game_id: _omitted, ...withoutGame } = record;
    const response = await POST(makeRequest({ type: "INSERT", table: "inquiries", record: withoutGame }));
    expect(response.status).toBe(200);
  });
});
