import { describe, it, expect, vi, beforeEach } from "vitest";

const { shrinkImageBuffer } = vi.hoisted(() => ({ shrinkImageBuffer: vi.fn() }));
vi.mock("@/lib/shrink-image-server", () => ({ shrinkImageBuffer }));

import { loadReplyAttachments, saveInboundAttachments } from "@/lib/message-attachments";
import { MAX_IMAGE_BYTES } from "@/lib/attachment-rules";

function fakeSupabase() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const client = {
    storage: { from: () => ({ upload, remove }) },
    from: () => ({ insert }),
  };
  return { client: client as never, upload, insert };
}

describe("saveInboundAttachments", () => {
  beforeEach(() => shrinkImageBuffer.mockReset());

  it("uploads photos within the limit as they are", async () => {
    const { client, upload } = fakeSupabase();
    const saved = await saveInboundAttachments(client, {
      inquiryId: "inq-1",
      messageId: "msg-1",
      attachments: [{ attachmentId: "a1", filename: "shot.png", mimeType: "image/png", size: 10 }],
      download: async () => Buffer.alloc(10),
    });
    expect(saved).toBe(1);
    expect(shrinkImageBuffer).not.toHaveBeenCalled();
    expect(upload.mock.calls[0][0]).toMatch(/^inq-1\/messages\/.+-shot\.png$/);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: "image/png" });
  });

  it("shrinks a photo over the limit to JPEG and keeps the original name with .jpg", async () => {
    const { client, upload, insert } = fakeSupabase();
    shrinkImageBuffer.mockResolvedValue({ data: Buffer.alloc(100), contentType: "image/jpeg" });
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);

    const saved = await saveInboundAttachments(client, {
      inquiryId: "inq-1",
      messageId: "msg-1",
      attachments: [{ attachmentId: "a1", filename: "캡처.png", mimeType: "image/png", size: big.length }],
      download: async () => big,
    });

    expect(saved).toBe(1);
    expect(shrinkImageBuffer).toHaveBeenCalledWith(big, MAX_IMAGE_BYTES);
    expect(upload.mock.calls[0][0]).toMatch(/\.jpg$/);
    expect(upload.mock.calls[0][1]).toHaveLength(100);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: "image/jpeg" });
    expect(insert.mock.calls[0][0][0]).toMatchObject({ file_name: "캡처.jpg" });
  });

  it("skips a photo it cannot shrink but saves the rest", async () => {
    const { client, upload } = fakeSupabase();
    shrinkImageBuffer.mockResolvedValue(null);
    const saved = await saveInboundAttachments(client, {
      inquiryId: "inq-1",
      messageId: "msg-1",
      attachments: [
        { attachmentId: "big", filename: "big.png", mimeType: "image/png", size: MAX_IMAGE_BYTES + 1 },
        { attachmentId: "ok", filename: "ok.png", mimeType: "image/png", size: 10 },
      ],
      download: async (id) => (id === "big" ? Buffer.alloc(MAX_IMAGE_BYTES + 1) : Buffer.alloc(10)),
    });
    expect(saved).toBe(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toMatch(/ok\.png$/);
  });
});

describe("loadReplyAttachments", () => {
  function storageWith(blobs: Record<string, Blob>) {
    return {
      storage: {
        from: () => ({
          download: async (path: string) => (blobs[path] ? { data: blobs[path], error: null } : { data: null, error: { message: "nf" } }),
        }),
      },
    } as never;
  }

  it("reads uploaded photos and PDF·Excel files as mail attachments", async () => {
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const client = storageWith({
      "inq-1/messages/u-a.png": new Blob([new Uint8Array(3)], { type: "image/png" }),
      "inq-1/messages/u-b.pdf": new Blob([new Uint8Array(4)], { type: "application/pdf" }),
      "inq-1/messages/u-c.xlsx": new Blob([new Uint8Array(5)], { type: xlsx }),
    });
    const loaded = await loadReplyAttachments(client, "inq-1", [
      { path: "inq-1/messages/u-a.png", fileName: "a.png" },
      { path: "inq-1/messages/u-b.pdf", fileName: "명세서.pdf" },
      { path: "inq-1/messages/u-c.xlsx", fileName: "정산.xlsx" },
    ]);
    expect(loaded.map((file) => [file.contentType, file.filename, file.data.length])).toEqual([
      ["image/png", "a.png", 3],
      ["application/pdf", "명세서.pdf", 4],
      [xlsx, "정산.xlsx", 5],
    ]);
  });

  it("refuses a stored file of any other type", async () => {
    const client = storageWith({ "inq-1/messages/u-a.zip": new Blob(["x"], { type: "application/zip" }) });
    await expect(loadReplyAttachments(client, "inq-1", [{ path: "inq-1/messages/u-a.zip", fileName: "a.zip" }])).rejects.toThrow("bad_type");
  });
});
