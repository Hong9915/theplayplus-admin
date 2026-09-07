import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  AttachmentError,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  extractAttachmentText,
  isSupportedAttachment,
  serializeAttachments,
} from "@/lib/attachments";

function file(name: string, content: string | Uint8Array): { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

describe("isSupportedAttachment", () => {
  it("accepts text, table, and xlsx extensions regardless of case", () => {
    for (const name of ["a.txt", "b.MD", "c.csv", "d.tsv", "e.json", "f.xlsx"]) {
      expect(isSupportedAttachment(name)).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const name of ["a.pdf", "b.png", "c.xls", "d.docx", "noext"]) {
      expect(isSupportedAttachment(name)).toBe(false);
    }
  });
});

describe("extractAttachmentText", () => {
  it("returns utf-8 text files as-is without a BOM", async () => {
    const result = await extractAttachmentText(file("보상.txt", "﻿52009 VIP3\n52010 VIP1"));
    expect(result).toEqual({ name: "보상.txt", size: 24, text: "52009 VIP3\n52010 VIP1" });
  });

  it("falls back to EUC-KR when the bytes are not valid utf-8", async () => {
    // "가나" in EUC-KR
    const bytes = new Uint8Array([0xb0, 0xa1, 0xb3, 0xaa]);
    const result = await extractAttachmentText(file("old.txt", bytes));
    expect(result.text).toBe("가나");
  });

  it("turns an xlsx workbook into the sheet table format with row numbers", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("VIP");
    sheet.addRow(["이메일", "VIP 단계"]);
    sheet.addRow(["a@x.com", "VIP3"]);
    sheet.addRow(["b@x.com", 4]);
    const buffer = await workbook.xlsx.writeBuffer();

    const result = await extractAttachmentText(file("vip.xlsx", new Uint8Array(buffer as ArrayBuffer)));

    expect(result.text).toBe(["## VIP", "행 | 이메일 | VIP 단계", "2 | a@x.com | VIP3", "3 | b@x.com | 4"].join("\n"));
  });

  it("rejects unsupported types", async () => {
    await expect(extractAttachmentText(file("a.pdf", "x"))).rejects.toMatchObject({ reason: "unsupported_type" });
  });

  it("rejects files over the size limit", async () => {
    const big = { ...file("a.txt", "x"), size: MAX_ATTACHMENT_BYTES + 1 };
    await expect(extractAttachmentText(big)).rejects.toBeInstanceOf(AttachmentError);
    await expect(extractAttachmentText(big)).rejects.toMatchObject({ reason: "file_too_large" });
  });

  it("rejects a broken xlsx as unreadable", async () => {
    await expect(extractAttachmentText(file("a.xlsx", "not a zip"))).rejects.toMatchObject({ reason: "file_unreadable" });
  });
});

describe("limits", () => {
  it("allows 4MB per file and 4MB per message, under Vercel's 4.5MB body cap", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_MESSAGE_ATTACHMENT_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe("serializeAttachments", () => {
  it("lists each file under its own heading", () => {
    const text = serializeAttachments([
      { name: "보상.txt", text: "52009 VIP3" },
      { name: "코드.csv", text: "code,used\nA1,yes" },
    ]);
    expect(text).toBe(["## 보상.txt", "52009 VIP3", "", "## 코드.csv", "code,used", "A1,yes"].join("\n"));
  });

  it("returns an empty string for no files", () => {
    expect(serializeAttachments([])).toBe("");
  });
});
