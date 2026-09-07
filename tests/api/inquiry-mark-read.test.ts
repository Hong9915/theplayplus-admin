import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/mark-read/route";
import * as supabaseModule from "@/lib/supabase";
import * as sessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));

function makeRequest() {
  return new Request("http://localhost/api/inquiries/inq-1/mark-read", { method: "POST" });
}

function mockClient(updateError: { message: string } | null = null) {
  const eq = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
  return { from, update, eq };
}

describe("POST /api/inquiries/[id]/mark-read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(true);
  });

  it("returns 401 without an admin session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    const { update } = mockClient();
    const response = await POST(makeRequest(), { params: { id: "inq-1" } });
    expect(response.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("clears unread_reply_at on the inquiry", async () => {
    const { from, update, eq } = mockClient();
    const response = await POST(makeRequest(), { params: { id: "inq-1" } });
    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("inquiries");
    expect(update).toHaveBeenCalledWith({ unread_reply_at: null });
    expect(eq).toHaveBeenCalledWith("id", "inq-1");
  });

  it("answers 500 when the update fails", async () => {
    mockClient({ message: "boom" });
    const response = await POST(makeRequest(), { params: { id: "inq-1" } });
    expect(response.status).toBe(500);
  });
});
