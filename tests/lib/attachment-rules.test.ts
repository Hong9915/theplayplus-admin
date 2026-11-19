import { describe, it, expect } from "vitest";
import {
  isDocumentFileName,
  isMessageAttachmentPathOf,
  messageAttachmentPath,
  replyFileType,
  safeFileName,
} from "@/lib/attachment-rules";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("replyFileType", () => {
  it("accepts photos and PDF·Excel documents by their MIME type", () => {
    expect(replyFileType("a.png", "image/png")).toBe("image/png");
    expect(replyFileType("명세.pdf", "application/pdf")).toBe("application/pdf");
    expect(replyFileType("정산.xlsx", XLSX)).toBe(XLSX);
    expect(replyFileType("old.xls", "application/vnd.ms-excel")).toBe("application/vnd.ms-excel");
  });

  it("falls back to the extension when the browser gives no usable type", () => {
    expect(replyFileType("정산.XLSX", "")).toBe(XLSX);
    expect(replyFileType("a.pdf", "application/octet-stream")).toBe("application/pdf");
  });

  it("refuses anything else", () => {
    expect(replyFileType("a.zip", "application/zip")).toBeNull();
    expect(replyFileType("a.docx", "")).toBeNull();
    expect(replyFileType("a.svg", "image/svg+xml")).toBeNull();
  });
});

describe("isDocumentFileName", () => {
  it("tells documents from photos by extension", () => {
    expect(isDocumentFileName("명세.PDF")).toBe(true);
    expect(isDocumentFileName("정산.xlsx")).toBe(true);
    expect(isDocumentFileName("old.xls")).toBe(true);
    expect(isDocumentFileName("화면.png")).toBe(false);
    expect(isDocumentFileName("pdf")).toBe(false);
    expect(isDocumentFileName("a.constructor")).toBe(false);
  });
});

describe("safeFileName", () => {
  it("keeps only characters Supabase Storage accepts in a key", () => {
    expect(safeFileName("보상 화면 (1).png", "image/png")).toBe("_______1_.png");
    expect(safeFileName("screen shot.JPG", "image/jpeg")).toBe("screen_shot.JPG");
  });

  it("falls back to a generic name when nothing meaningful is left", () => {
    expect(safeFileName("보상.png", "image/png")).toBe("image.png");
    expect(safeFileName("", "image/jpeg")).toBe("image.jpg");
    expect(safeFileName(null, "image/webp")).toBe("image.webp");
    expect(safeFileName("정산.xlsx", XLSX)).toBe("file.xlsx");
    expect(safeFileName("", "application/pdf")).toBe("file.pdf");
  });

  it("drops any directory part", () => {
    expect(safeFileName("../../etc/a.png", "image/png")).toBe("a.png");
  });
});

describe("message attachment paths", () => {
  it("only accepts paths under the inquiry's own messages folder", () => {
    const path = messageAttachmentPath("inq-1", "a.png", "u");
    expect(isMessageAttachmentPathOf("inq-1", path)).toBe(true);
    expect(isMessageAttachmentPathOf("inq-2", path)).toBe(false);
    expect(isMessageAttachmentPathOf("inq-1", "inq-1/screenshot.png")).toBe(false);
    expect(isMessageAttachmentPathOf("inq-1", "inq-1/messages/../../inq-2/x.png")).toBe(false);
  });
});
