import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/bulk-status/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";
import * as eventsModule from "@/lib/events";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ getAdminSession: vi.fn() }));
vi.mock("@/lib/events", () => ({ recordEvent: vi.fn() }));

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

function mockDb(before: Array<{ id: string; status: string }>, updateError: { message: string } | null = null) {
  const selectIn = vi.fn().mockResolvedValue({ data: before, error: null });
  const select = vi.fn(() => ({ in: selectIn }));
  const updateIn = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn(() => ({ in: updateIn }));
  const from = vi.fn(() => ({ select, update }));
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
  return { update, updateIn };
}

function request(body: unknown) {
  return new Request("http://localhost/api/inquiries/bulk-status", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/inquiries/bulk-status", () => {
  beforeEach(() => {
    vi.mocked(sessionModule.getAdminSession).mockReset().mockResolvedValue({ id: "u1", email: "admin@x.com" });
    vi.mocked(eventsModule.recordEvent).mockReset().mockResolvedValue(undefined);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(sessionModule.getAdminSession).mockResolvedValue(null);
    const response = await POST(request({ ids: [A], status: "resolved" }));
    expect(response.status).toBe(401);
  });

  it("rejects malformed input", async () => {
    mockDb([]);
    expect((await POST(request({ ids: [], status: "resolved" }))).status).toBe(400);
    expect((await POST(request({ ids: ["not-a-uuid"], status: "resolved" }))).status).toBe(400);
    expect((await POST(request({ ids: [A], status: "done" }))).status).toBe(400);
  });

  it("updates only the inquiries whose status actually changes and logs each", async () => {
    const { update, updateIn } = mockDb([
      { id: A, status: "new" },
      { id: B, status: "resolved" },
      { id: C, status: "in_progress" },
    ]);

    const response = await POST(request({ ids: [A, B, C], status: "resolved" }));

    expect(update).toHaveBeenCalledWith({ status: "resolved" });
    expect(updateIn).toHaveBeenCalledWith("id", [A, C]);
    expect(eventsModule.recordEvent).toHaveBeenCalledTimes(2);
    expect(eventsModule.recordEvent).toHaveBeenCalledWith(expect.anything(), {
      inquiryId: A,
      actor: { id: "u1", email: "admin@x.com" },
      kind: "status_changed",
      fromValue: "new",
      toValue: "resolved",
    });
    await expect(response.json()).resolves.toEqual({ success: true, updated: 2 });
  });

  it("is a no-op when nothing would change", async () => {
    const { update } = mockDb([{ id: A, status: "resolved" }]);
    const response = await POST(request({ ids: [A], status: "resolved" }));
    expect(update).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ success: true, updated: 0 });
  });

  it("reports an update failure", async () => {
    mockDb([{ id: A, status: "new" }], { message: "boom" });
    const response = await POST(request({ ids: [A], status: "resolved" }));
    expect(response.status).toBe(500);
    expect(eventsModule.recordEvent).not.toHaveBeenCalled();
  });
});
