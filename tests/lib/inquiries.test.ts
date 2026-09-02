import { describe, it, expect, vi } from "vitest";
import { listInquiriesByGame, getInquiryById, listAttachmentSignedUrls } from "@/lib/inquiries";

const sampleRow = {
  id: "inq-1",
  game_id: "game-1",
  group_key: "game_usage",
  type_key: "bug_report",
  game_account: "player1",
  company_name: null,
  reply_email: "a@b.com",
  title: "제목",
  content: "내용",
  status: "new",
  reply_content: null,
  replied_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  inquiry_no: "R-20260101-0001",
  priority: "high",
  meta: { uid: "10024871" },
};

describe("listInquiriesByGame", () => {
  it("filters by game_id and orders by created_at desc", async () => {
    const order = vi.fn().mockResolvedValue({ data: [sampleRow], error: null });
    const eqGame = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq: eqGame }));
    const from = vi.fn(() => ({ select }));

    const result = await listInquiriesByGame({ from } as never, "game-1");
    expect(eqGame).toHaveBeenCalledWith("game_id", "game-1");
    expect(result[0].gameAccount).toBe("player1");
  });

  it("applies an additional status filter when provided", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eqStatus = vi.fn(() => ({ order }));
    const eqGame = vi.fn(() => ({ eq: eqStatus, order }));
    const select = vi.fn(() => ({ eq: eqGame }));
    const from = vi.fn(() => ({ select }));

    await listInquiriesByGame({ from } as never, "game-1", "resolved");
    expect(eqStatus).toHaveBeenCalledWith("status", "resolved");
  });
});

describe("getInquiryById", () => {
  it("returns null when the query errors", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await getInquiryById({ from } as never, "missing");
    expect(result).toBeNull();
  });

  it("maps a found row", async () => {
    const single = vi.fn().mockResolvedValue({ data: sampleRow, error: null });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await getInquiryById({ from } as never, "inq-1");
    expect(result?.status).toBe("new");
  });
});

describe("listAttachmentSignedUrls", () => {
  it("returns an empty array when there are no attachments", async () => {
    const eq = vi.fn().mockResolvedValue({ data: [], error: null });
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await listAttachmentSignedUrls({ from } as never, "inq-1");
    expect(result).toEqual([]);
  });

  it("signs a URL for each attachment", async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [{ id: "att-1", file_path: "inq-1/screenshot.png", file_name: "screenshot.png" }],
      error: null,
    });
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
    const storageFrom = vi.fn(() => ({ createSignedUrl }));

    const result = await listAttachmentSignedUrls({ from, storage: { from: storageFrom } } as never, "inq-1");
    expect(createSignedUrl).toHaveBeenCalledWith("inq-1/screenshot.png", 3600);
    expect(result).toEqual([{ id: "att-1", fileName: "screenshot.png", signedUrl: "https://signed.example/x" }]);
  });
});

describe("mapInquiryRow via getInquiryById", () => {
  function mockSingle(row: unknown) {
    const single = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    return { from: vi.fn(() => ({ select })) };
  }

  it("maps inquiry_no, priority, and meta", async () => {
    const result = await getInquiryById(mockSingle(sampleRow) as never, "inq-1");
    expect(result?.inquiryNo).toBe("R-20260101-0001");
    expect(result?.priority).toBe("high");
    expect(result?.meta).toEqual({ uid: "10024871" });
  });

  it("falls back when inquiry_no, priority, and meta are missing", async () => {
    const bare = { ...sampleRow, inquiry_no: null, priority: null, meta: null };
    const result = await getInquiryById(mockSingle(bare) as never, "inq-1");
    expect(result?.inquiryNo).toBeNull();
    expect(result?.priority).toBe("normal");
    expect(result?.meta).toEqual({});
  });
});
