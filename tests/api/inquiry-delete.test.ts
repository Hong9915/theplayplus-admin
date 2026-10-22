import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE } from "@/app/api/inquiries/[id]/route";
import * as supabaseModule from "@/lib/supabase";
import * as requireAdminSessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/require-admin-session", () => ({
  requireAdminSession: vi.fn(),
}));

interface MockOptions {
  inquiry?: { id: string } | null;
  attachments?: Array<{ file_path: string }>;
  deleteError?: { message: string } | null;
}

function mockSupabase(options: MockOptions = {}) {
  const { inquiry = { id: "inq-1" }, attachments = [], deleteError = null } = options;

  const storageRemove = vi.fn().mockResolvedValue({ error: null });
  const deleteEq = vi.fn().mockResolvedValue({ error: deleteError });
  const inquiriesDelete = vi.fn(() => ({ eq: deleteEq }));

  const from = vi.fn((table: string) => {
    if (table === "inquiries") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: inquiry, error: inquiry ? null : { message: "not found" } }),
          })),
        })),
        delete: inquiriesDelete,
      };
    }
    if (table === "inquiry_attachments") {
      return {
        select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: attachments, error: null }) })),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  const client = { from, storage: { from: vi.fn(() => ({ remove: storageRemove })) } };
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue(client as never);
  return { storageRemove, inquiriesDelete, deleteEq, storageFrom: client.storage.from };
}

function makeRequest() {
  return new Request("http://localhost/api/inquiries/inq-1", { method: "DELETE" });
}

describe("DELETE /api/inquiries/[id]", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
  });

  it("returns 401 when there is no admin session", async () => {
    vi.mocked(requireAdminSessionModule.requireAdminSession).mockResolvedValue(false);
    const response = await DELETE(makeRequest(), { params: { id: "inq-1" } });
    expect(response.status).toBe(401);
  });

  it("returns 404 when the inquiry does not exist", async () => {
    const { inquiriesDelete } = mockSupabase({ inquiry: null });
    const response = await DELETE(makeRequest(), { params: { id: "inq-1" } });
    expect(response.status).toBe(404);
    expect(inquiriesDelete).not.toHaveBeenCalled();
  });

  it("deletes the inquiry and its attachment files", async () => {
    const { storageRemove, deleteEq, storageFrom } = mockSupabase({
      attachments: [{ file_path: "inq-1/a.png" }, { file_path: "inq-1/b.pdf" }],
    });

    const response = await DELETE(makeRequest(), { params: { id: "inq-1" } });

    expect(await response.json()).toEqual({ success: true });
    expect(deleteEq).toHaveBeenCalledWith("id", "inq-1");
    expect(storageFrom).toHaveBeenCalledWith("inquiry-attachments");
    expect(storageRemove).toHaveBeenCalledWith(["inq-1/a.png", "inq-1/b.pdf"]);
  });

  it("skips storage cleanup when there are no attachments", async () => {
    const { storageRemove } = mockSupabase();
    const response = await DELETE(makeRequest(), { params: { id: "inq-1" } });

    expect(await response.json()).toEqual({ success: true });
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("returns 500 and keeps the files when the delete fails", async () => {
    const { storageRemove } = mockSupabase({
      attachments: [{ file_path: "inq-1/a.png" }],
      deleteError: { message: "boom" },
    });
    const response = await DELETE(makeRequest(), { params: { id: "inq-1" } });

    expect(response.status).toBe(500);
    expect(storageRemove).not.toHaveBeenCalled();
  });
});
