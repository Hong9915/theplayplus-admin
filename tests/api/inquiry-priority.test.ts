import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/inquiries/[id]/priority/route";
import * as supabaseModule from "@/lib/supabase";
import * as eventsModule from "@/lib/events";
import * as sessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/events", () => ({
  recordEvent: vi.fn(),
}));

vi.mock("@/lib/require-admin-session", () => ({
  requireAdminSession: vi.fn(),
  getAdminSession: vi.fn(),
}));

const actor = { id: "user-1", email: "info@theplayplus.com" };

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/inquiries/inq-1/priority", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/inquiries/[id]/priority", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
    vi.mocked(eventsModule.recordEvent).mockReset().mockResolvedValue(undefined);
    vi.mocked(sessionModule.getAdminSession).mockReset().mockResolvedValue(actor);
  });

  function mockPriorityClient(currentPriority: string | null, updateError: { message: string } | null = null) {
    const single = vi.fn().mockResolvedValue({
      data: currentPriority === null ? null : { priority: currentPriority },
      error: null,
    });
    const eqSelect = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq: eqSelect }));
    const eqUpdate = vi.fn().mockResolvedValue({ error: updateError });
    const update = vi.fn(() => ({ eq: eqUpdate }));
    const from = vi.fn(() => ({ select, update }));
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
    return { from, update, eqUpdate };
  }

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(sessionModule.getAdminSession).mockResolvedValue(null);

    const response = await PATCH(patchRequest({ priority: "urgent" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ success: false, error: "unauthorized" });
  });

  it("rejects an invalid priority value", async () => {
    const response = await PATCH(patchRequest({ priority: "bogus" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ success: false, error: "invalid_priority" });
  });

  it("updates the priority and records an event with the previous value", async () => {
    const { from, update, eqUpdate } = mockPriorityClient("normal");

    const response = await PATCH(patchRequest({ priority: "urgent" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(from).toHaveBeenCalledWith("inquiries");
    expect(update).toHaveBeenCalledWith({ priority: "urgent" });
    expect(eqUpdate).toHaveBeenCalledWith("id", "inq-1");
    expect(eventsModule.recordEvent).toHaveBeenCalledWith(expect.anything(), {
      inquiryId: "inq-1",
      actor,
      kind: "priority_changed",
      fromValue: "normal",
      toValue: "urgent",
    });
    expect(json).toEqual({ success: true });
  });

  it("still returns success when recording the event fails", async () => {
    mockPriorityClient("normal");
    vi.mocked(eventsModule.recordEvent).mockRejectedValue(new Error("boom"));

    const response = await PATCH(patchRequest({ priority: "high" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("does not record an event when the update fails", async () => {
    mockPriorityClient("normal", { message: "db error" });

    const response = await PATCH(patchRequest({ priority: "low" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(500);
    expect(eventsModule.recordEvent).not.toHaveBeenCalled();
  });
});
