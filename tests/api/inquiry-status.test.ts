import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/inquiries/[id]/status/route";
import * as supabaseModule from "@/lib/supabase";
import * as requireAdminSessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/require-admin-session", () => ({
  requireAdminSession: vi.fn(),
}));

describe("PATCH /api/inquiries/[id]/status", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockResolvedValue(false);

    const request = new Request("http://localhost/api/inquiries/inq-1/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });
    const response = await PATCH(request, { params: { id: "inq-1" } });
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ success: false, error: "unauthorized" });
  });

  it("updates the status and returns success", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);

    const request = new Request("http://localhost/api/inquiries/inq-1/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });
    const response = await PATCH(request, { params: { id: "inq-1" } });
    const json = await response.json();

    expect(update).toHaveBeenCalledWith({ status: "in_progress" });
    expect(eq).toHaveBeenCalledWith("id", "inq-1");
    expect(json).toEqual({ success: true });
  });

  it("rejects an invalid status value", async () => {
    const request = new Request("http://localhost/api/inquiries/inq-1/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "bogus" }),
    });
    const response = await PATCH(request, { params: { id: "inq-1" } });
    expect(response.status).toBe(400);
  });

  it("returns 500 when the update fails", async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);

    const request = new Request("http://localhost/api/inquiries/inq-1/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "resolved" }),
    });
    const response = await PATCH(request, { params: { id: "inq-1" } });
    expect(response.status).toBe(500);
  });
});
