import { describe, it, expect, vi } from "vitest";
import { listNotes, listNotesByInquiryIds, createNote } from "@/lib/notes";

const sampleRow = {
  id: "note-1",
  author_email: "info@theplayplus.com",
  content: "결제 로그 확인함",
  created_at: "2026-09-02T04:00:00.000Z",
};

describe("listNotes", () => {
  it("filters by inquiry_id and orders oldest first", async () => {
    const order = vi.fn().mockResolvedValue({ data: [sampleRow], error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await listNotes({ from } as never, "inq-1");

    expect(from).toHaveBeenCalledWith("inquiry_notes");
    expect(eq).toHaveBeenCalledWith("inquiry_id", "inq-1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result).toEqual([
      {
        id: "note-1",
        authorEmail: "info@theplayplus.com",
        content: "결제 로그 확인함",
        createdAt: "2026-09-02T04:00:00.000Z",
      },
    ]);
  });

  it("returns an empty array when the query errors", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    await expect(listNotes({ from } as never, "inq-1")).resolves.toEqual([]);
  });
});

describe("createNote", () => {
  it("inserts the note and reports success", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));

    const ok = await createNote({ from } as never, {
      inquiryId: "inq-1",
      author: { id: "user-1", email: "info@theplayplus.com" },
      content: "결제 로그 확인함",
    });

    expect(insert).toHaveBeenCalledWith({
      inquiry_id: "inq-1",
      author_id: "user-1",
      author_email: "info@theplayplus.com",
      content: "결제 로그 확인함",
    });
    expect(ok).toBe(true);
  });

  it("reports failure instead of throwing when the insert errors", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    const from = vi.fn(() => ({ insert }));

    const ok = await createNote({ from } as never, {
      inquiryId: "inq-1",
      author: { id: "user-1", email: "a@b.com" },
      content: "x",
    });

    expect(ok).toBe(false);
  });
});

describe("listNotesByInquiryIds", () => {
  it("fetches notes for several inquiries at once, grouped by inquiry", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        { ...sampleRow, inquiry_id: "inq-2" },
        { ...sampleRow, id: "note-2", inquiry_id: "inq-1", content: "두 번째" },
      ],
      error: null,
    });
    const inFn = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));

    const grouped = await listNotesByInquiryIds({ from } as never, ["inq-1", "inq-2"]);

    expect(from).toHaveBeenCalledWith("inquiry_notes");
    expect(inFn).toHaveBeenCalledWith("inquiry_id", ["inq-1", "inq-2"]);
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(grouped["inq-2"]).toEqual([
      { id: "note-1", authorEmail: "info@theplayplus.com", content: "결제 로그 확인함", createdAt: "2026-09-02T04:00:00.000Z" },
    ]);
    expect(grouped["inq-1"][0].content).toBe("두 번째");
  });

  it("skips the query for an empty id list", async () => {
    const from = vi.fn();
    await expect(listNotesByInquiryIds({ from } as never, [])).resolves.toEqual({});
    expect(from).not.toHaveBeenCalled();
  });
});
