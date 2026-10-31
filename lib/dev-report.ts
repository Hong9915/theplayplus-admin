import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { imageSize } from "image-size";
import { parseTranslations, type Translations } from "@/lib/translations";

/**
 * 개발사 전달용 엑셀. 개발사가 쓰는 양식(한·중 두 줄 머리글: 시간 · 서버(구역) · 캐릭터 ID · 캐릭터명 · 문제 · 문제 스크린샷)
 * 그대로 문의 한 건을 한 줄로 쓰고, 첨부 이미지는 스크린샷 칸 안에 그림으로 넣는다(2026-10-30 숲의 소환단).
 */

export const DEV_REPORT_MAX_INQUIRIES = 100;

export interface DevReportScreenshot {
  fileName: string;
  /** 내려받지 못했으면 null. 칸에 파일 이름만 적는다. */
  data: Buffer | null;
}

export interface DevReportInquiry {
  occurredAt: string | null;
  createdAt: string;
  serverName: string | null;
  characterId: string | null;
  characterName: string | null;
  title: string;
  content: string;
  translations: Translations;
  screenshots: DevReportScreenshot[];
}

const FIXED_HEADERS: Array<{ ko: string; zh: string; width: number }> = [
  { ko: "시간", zh: "时间", width: 18 },
  { ko: "서버(구역)", zh: "区服", width: 14 },
  { ko: "캐릭터 ID", zh: "角色ID", width: 18 },
  { ko: "캐릭터명", zh: "角色名", width: 16 },
  { ko: "문제", zh: "问题", width: 50 },
];
const SCREENSHOT_HEADER = { ko: "문제 스크린샷", zh: "问题截图" };
/** 양식에 스크린샷 칸이 두 개 있다. 첨부가 더 많은 문의가 있으면 그만큼 늘린다. */
const MIN_SCREENSHOT_COLUMNS = 2;

const SCREENSHOT_COLUMN_WIDTH = 30; // 글자 단위, 약 215px
const SCREENSHOT_BOX = { width: 200, height: 150 }; // px
const ROW_HEIGHT_WITH_IMAGE = 120; // pt (= 160px)
const HEADER_FILL = "FF2F6FED";
const EXCEL_IMAGE_TYPES = new Set(["png", "jpg", "gif"]);

const seoulParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 발생 일시(datetime-local)가 있으면 그것, 없으면 접수 시각(서울)을 "2026-09-03 14:05"로. */
export function devReportTime(occurredAt: string | null, createdAt: string): string {
  const match = occurredAt ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(occurredAt) : null;
  if (match) return `${match[1]} ${match[2]}`;
  const parts: Record<string, string> = {};
  for (const part of seoulParts.formatToParts(new Date(createdAt))) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** 제목과 본문. 관리자가 중국어로 번역해 둔 문의는 번역문도 붙인다. */
export function devReportProblem(inquiry: Pick<DevReportInquiry, "title" | "content" | "translations">): string {
  const original = `${inquiry.title}\n${inquiry.content}`.trim();
  const zh = inquiry.translations.zh?.trim();
  return zh ? `${original}\n\n[中文]\n${zh}` : original;
}

function fitInBox(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(SCREENSHOT_BOX.width / width, SCREENSHOT_BOX.height / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** 엑셀이 넣을 수 있는 그림(png/jpeg/gif)이면 종류와 크기를, 아니면 null. */
function readImage(data: Buffer): { extension: "png" | "jpeg" | "gif"; width: number; height: number } | null {
  try {
    const size = imageSize(data);
    if (!size.type || !EXCEL_IMAGE_TYPES.has(size.type) || !size.width || !size.height) return null;
    return { extension: size.type === "jpg" ? "jpeg" : (size.type as "png" | "gif"), width: size.width, height: size.height };
  } catch {
    return null;
  }
}

export async function buildDevReportWorkbook(inquiries: DevReportInquiry[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  // 인쇄·PDF로 넘겨도 한 장 너비에 다 들어가게.
  const sheet = workbook.addWorksheet("문의", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const screenshotColumns = Math.max(MIN_SCREENSHOT_COLUMNS, ...inquiries.map((i) => i.screenshots.length));
  const headers = [...FIXED_HEADERS, ...Array.from({ length: screenshotColumns }, () => ({ ...SCREENSHOT_HEADER, width: SCREENSHOT_COLUMN_WIDTH }))];

  sheet.columns = headers.map((h) => ({ width: h.width }));
  sheet.addRow(headers.map((h) => h.ko));
  sheet.addRow(headers.map((h) => h.zh));
  for (const rowNo of [1, 2]) {
    const row = sheet.getRow(rowNo);
    row.height = 22;
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    });
  }
  sheet.views = [{ state: "frozen", ySplit: 2 }];

  inquiries.forEach((inquiry, index) => {
    const rowNo = index + 3;
    const images = inquiry.screenshots.map((shot) => ({ shot, image: shot.data ? readImage(shot.data) : null }));
    const row = sheet.getRow(rowNo);
    row.values = [
      devReportTime(inquiry.occurredAt, inquiry.createdAt),
      inquiry.serverName ?? "",
      inquiry.characterId ?? "",
      inquiry.characterName ?? "",
      devReportProblem(inquiry),
      // 그림으로 못 넣는 첨부(webp, 내려받기 실패)는 파일 이름만 적는다.
      ...images.map(({ shot, image }) => (image ? "" : shot.fileName)),
    ];
    if (images.some(({ image }) => image)) row.height = ROW_HEIGHT_WITH_IMAGE;
    for (let col = 1; col <= headers.length; col++) {
      const cell = row.getCell(col);
      cell.alignment = { vertical: "top", horizontal: col === 5 ? "left" : "center", wrapText: true };
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    }

    images.forEach(({ shot, image }, shotIndex) => {
      if (!image || !shot.data) return;
      const imageId = workbook.addImage({ buffer: shot.data as unknown as ExcelJS.Buffer, extension: image.extension });
      sheet.addImage(imageId, {
        tl: { col: FIXED_HEADERS.length + shotIndex + 0.05, row: rowNo - 1 + 0.05 },
        ext: fitInBox(image.width, image.height),
        editAs: "oneCell",
      });
    });
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** 고른 문의를 접수 순으로 읽고 첨부를 내려받는다. 첨부 하나를 못 받아도 나머지는 그대로 만든다. */
export async function loadDevReportInquiries(supabase: SupabaseClient, ids: string[]): Promise<DevReportInquiry[]> {
  const { data, error } = await supabase
    .from("inquiries")
    .select("id, title, content, occurred_at, server_name, character_id, character_name, translations, created_at")
    .in("id", ids)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`Failed to load inquiries: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    content: string | null;
    occurred_at: string | null;
    server_name: string | null;
    character_id: string | null;
    character_name: string | null;
    translations: unknown;
    created_at: string;
  }>;

  const files = rows.length ? await listReportFiles(supabase, rows.map((r) => r.id)) : [];
  const downloaded = await Promise.all(
    files.map(async (file) => {
      const { data: blob } = await supabase.storage.from("inquiry-attachments").download(file.file_path);
      return { ...file, data: blob ? Buffer.from(await blob.arrayBuffer()) : null };
    })
  );

  return rows.map((row) => ({
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    serverName: row.server_name,
    characterId: row.character_id,
    characterName: row.character_name,
    title: row.title,
    content: row.content ?? "",
    translations: parseTranslations(row.translations),
    screenshots: downloaded.filter((f) => f.inquiry_id === row.id).map((f) => ({ fileName: f.file_name, data: f.data })),
  }));
}

type ReportFile = { inquiry_id: string; file_path: string; file_name: string; message_id?: string | null };

/**
 * 엑셀에 넣을 스크린샷. 접수 폼 첨부와 사용자가 회신에 붙인 사진은 넣고, 우리가 답변에
 * 붙여 보낸 사진은 뺀다(개발사에 전달할 문제 화면이 아니다). 0035 실행 전이면 열 없이 읽는다.
 */
async function listReportFiles(supabase: SupabaseClient, inquiryIds: string[]): Promise<ReportFile[]> {
  const query = (columns: string) =>
    supabase.from("inquiry_attachments").select(columns).in("inquiry_id", inquiryIds).order("created_at", { ascending: true });
  let { data, error } = await query("inquiry_id, file_path, file_name, message_id");
  if (error) ({ data, error } = await query("inquiry_id, file_path, file_name"));
  const files = ((error ? null : data) ?? []) as unknown as ReportFile[];

  const messageIds = Array.from(new Set(files.map((f) => f.message_id).filter((id): id is string => !!id)));
  if (messageIds.length === 0) return files;
  const { data: messages } = await supabase.from("inquiry_messages").select("id, direction").in("id", messageIds);
  // 방향을 못 읽은 메시지의 사진은 우리 답변일 수도 있으니 뺀다.
  const inbound = new Set(
    ((messages ?? []) as Array<{ id: string; direction: string }>).filter((m) => m.direction === "inbound").map((m) => m.id)
  );
  return files.filter((f) => !f.message_id || inbound.has(f.message_id));
}
