import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/notes/route";
import * as supabaseModule from "@/lib/supabase";
import * as notesModule from "@/lib/notes";
import * as eventsModule from "@/lib/events";
import * as sessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/notes", () => ({ createNote: vi.fn() }));
vi.mock("@/lib/events", () => ({ recordEvent: vi.fn() }));
vi.mock("@/lib/require-admin-session", () => ({ getAdminSession: vi.fn() }));

function postRequest(body: unknown) {
  return new Request("http://localhost/api/inquiries/inq-1/notes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const actor = { id: "user-1", email: "info@theplayplus.com" };

describe("POST /api/inquiries/[id]/notes", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset().mockReturnValue({} as never);
    vi.mocked(notesModule.createNote).mockReset().mockResolvedValue(true);
    vi.mocked(eventsModule.recordEvent).mockReset().mockResolvedValue(undefined);
    vi.mocked(sessionModule.getAdminSession).mockReset().mockResolvedValue(actor);
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(sessionModule.getAdminSession).mockResolvedValue(null);

    const response = await POST(postRequest({ content: "메모" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ success: false, error: "unauthorized" });
    expect(notesModule.createNote).not.toHaveBeenCalled();
  });

  it("rejects an empty note", async () => {
    const response = await POST(postRequest({ content: "   " }), { params: { id: "inq-1" } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, error: "invalid_note" });
    expect(notesModule.createNote).not.toHaveBeenCalled();
  });

  it("creates the note and records a note_added event", async () => {
    const response = await POST(postRequest({ content: "  결제 로그 확인함  " }), { params: { id: "inq-1" } });

    expect(notesModule.createNote).toHaveBeenCalledWith(expect.anything(), {
      inquiryId: "inq-1",
      author: actor,
      content: "결제 로그 확인함",
    });
    expect(eventsModule.recordEvent).toHaveBeenCalledWith(expect.anything(), {
      inquiryId: "inq-1",
      actor,
      kind: "note_added",
    });
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("returns 500 when the note could not be saved", async () => {
    vi.mocked(notesModule.createNote).mockResolvedValue(false);

    const response = await POST(postRequest({ content: "메모" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ success: false, error: "save_failed" });
    expect(eventsModule.recordEvent).not.toHaveBeenCalled();
  });

  it("still returns success when recording the event fails", async () => {
    vi.mocked(eventsModule.recordEvent).mockRejectedValue(new Error("boom"));

    const response = await POST(postRequest({ content: "메모" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });
});
