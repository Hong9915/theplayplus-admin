/**
 * 운영 어시스턴트 메시지 첨부 파일.
 *
 * 원본은 보관하지 않고 텍스트만 뽑아 메시지 행에 남긴다. 표 파일(xlsx)은 시트와
 * 같은 형식(탭 제목 + 행 번호 + `|`)으로 바꿔 모델이 한 가지 표 문법만 읽게 한다.
 */
import ExcelJS from "exceljs";
import { detectHeader, serializeSheets, type SheetTab } from "@/lib/sheets";
import { MAX_ATTACHMENT_BYTES, TABLE_EXTENSIONS, extensionOf, isSupportedAttachment } from "@/lib/attachment-rules";

export type AttachmentErrorReason = "unsupported_type" | "file_too_large" | "too_many_files" | "attachments_too_large" | "file_unreadable";

export class AttachmentError extends Error {
  constructor(
    public readonly reason: AttachmentErrorReason,
    message?: string
  ) {
    super(message ?? reason);
    this.name = "AttachmentError";
  }
}

export interface Attachment {
  name: string;
  size: number;
  text: string;
}

export {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_TEXT_CHARS,
  SUPPORTED_ATTACHMENT_ACCEPT,
  isSupportedAttachment,
} from "@/lib/attachment-rules";

/** utf-8이 아니면 EUC-KR로 본다. 오래된 운영 원장 txt는 윈도우 기본 인코딩인 경우가 있다. */
function decodeText(bytes: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("euc-kr").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

async function workbookToText(bytes: ArrayBuffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    throw new AttachmentError("file_unreadable");
  }
  const tabs: SheetTab[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = cell.text ?? "";
      });
      rows[rowNumber - 1] = Array.from(cells, (cell) => cell ?? "");
    });
    for (let i = 0; i < rows.length; i += 1) rows[i] ??= [];
    tabs.push({ title: sheet.name, header: detectHeader(rows[0]), rows });
  });
  return serializeSheets(tabs);
}

export async function extractAttachmentText(file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<Attachment> {
  if (!isSupportedAttachment(file.name)) throw new AttachmentError("unsupported_type");
  if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentError("file_too_large");

  const bytes = await file.arrayBuffer();
  const text = TABLE_EXTENSIONS.has(extensionOf(file.name)) ? await workbookToText(bytes) : decodeText(bytes);
  return { name: file.name, size: file.size, text };
}

/** 프롬프트의 "# 첨부 파일" 아래에 들어갈 본문. 파일마다 제목을 달아 근거를 밝히기 쉽게 한다. */
export function serializeAttachments(attachments: Array<{ name: string; text: string }>): string {
  return attachments.map((attachment) => `## ${attachment.name}\n${attachment.text}`).join("\n\n");
}
