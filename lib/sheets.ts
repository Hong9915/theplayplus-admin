/**
 * 운영 시트 어시스턴트의 구글 시트 연동.
 *
 * 순수 함수(파싱·직렬화·검증)와 Sheets API 호출을 한 파일에 두되, 전자는 API
 * 없이 테스트한다. 검색 방식을 임베딩으로 바꾸게 되더라도 이 파일만 바꾼다.
 */
import { google, type sheets_v4 } from "googleapis";

export type SheetErrorReason =
  | "not_configured"
  | "sheet_forbidden"
  | "sheet_not_found"
  | "sheet_too_large"
  | "sheet_read_failed"
  | "sheet_write_failed"
  | "invalid_proposal"
  | "conflict";

export class SheetError extends Error {
  constructor(
    public readonly reason: SheetErrorReason,
    message?: string
  ) {
    super(message ?? reason);
    this.name = "SheetError";
  }
}

/** rows[i]는 시트의 i+1행. 헤더가 있으면 rows[0]이 헤더다. */
export interface SheetTab {
  title: string;
  header: string[] | null;
  rows: string[][];
}

export type ProposalUpdate = { column: string; before: string; after: string };

export type Proposal =
  | { kind: "update"; sheet: string; row: number; updates: ProposalUpdate[] }
  | { kind: "append"; sheet: string; values: Record<string, string> };

export const MAX_SHEET_CHARS = 300_000;

const SHEET_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 전체 URL이든 ID만이든 스프레드시트 ID를 돌려준다. 못 찾으면 null. */
export function parseSheetUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  return SHEET_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/** 첫 행이 두 칸 이상이고 모두 비어 있지 않으며 서로 다르면 열 이름으로 본다. 한 칸뿐이면 표 제목 같은 자유 텍스트일 뿐 열 이름으로 보지 않는다. */
export function detectHeader(firstRow: string[] | undefined): string[] | null {
  if (!firstRow || firstRow.length < 2) return null;
  const cells = firstRow.map((cell) => cell.trim());
  if (cells.some((cell) => cell === "")) return null;
  if (new Set(cells).size !== cells.length) return null;
  return cells;
}

function cleanCell(cell: string): string {
  return cell.replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/** 모델에 넘길 텍스트 표. 행 번호를 붙여야 수정 대상을 정확히 지목한다. */
export function serializeSheets(tabs: SheetTab[]): string {
  const blocks: string[] = [];
  for (const tab of tabs) {
    const lines: string[] = [`## ${tab.title}`];
    if (tab.header) {
      lines.push(["행", ...tab.header.map(cleanCell)].join(" | "));
      tab.rows.forEach((row, index) => {
        if (index === 0) return;
        if (row.every((cell) => cell.trim() === "")) return;
        const cells = tab.header!.map((_, col) => cleanCell(row[col] ?? ""));
        lines.push([String(index + 1), ...cells].join(" | "));
      });
    } else {
      lines.push("행 | 내용");
      tab.rows.forEach((row, index) => {
        const joined = cleanCell(row.join(" "));
        if (!joined) return;
        lines.push(`${index + 1} | ${joined}`);
      });
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/** 0 → A, 25 → Z, 26 → AA */
export function columnToA1(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function findEditableTab(tabs: SheetTab[], title: unknown): (SheetTab & { header: string[] }) | null {
  if (typeof title !== "string") return null;
  const tab = tabs.find((entry) => entry.title === title);
  if (!tab || !tab.header) return null;
  return tab as SheetTab & { header: string[] };
}

function toCellString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/**
 * 모델이 도구로 내놓은 값을 검증해 Proposal로 만든다. 탭·열·행이 시트에 있어야
 * 하고, update의 before는 모델이 적은 값 대신 시트의 현재 값으로 채운다(모델이
 * 잘못 옮겨 적어도 적용 시점의 충돌 검사가 의미 있게).
 */
export function prepareProposal(tabs: SheetTab[], raw: unknown): Proposal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const tab = findEditableTab(tabs, input.sheet);
  if (!tab) return null;

  if (input.kind === "update") {
    const row = input.row;
    if (typeof row !== "number" || !Number.isInteger(row) || row < 2 || row > tab.rows.length) return null;
    if (!Array.isArray(input.updates) || input.updates.length === 0) return null;
    const updates: ProposalUpdate[] = [];
    for (const entry of input.updates as unknown[]) {
      if (typeof entry !== "object" || entry === null) return null;
      const { column, after } = entry as Record<string, unknown>;
      const col = typeof column === "string" ? tab.header.indexOf(column) : -1;
      const afterText = toCellString(after);
      if (col < 0 || afterText === null) return null;
      updates.push({ column: column as string, before: tab.rows[row - 1]?.[col] ?? "", after: afterText });
    }
    return { kind: "update", sheet: tab.title, row, updates };
  }

  if (input.kind === "append") {
    if (typeof input.values !== "object" || input.values === null) return null;
    const values: Record<string, string> = {};
    for (const [column, value] of Object.entries(input.values as Record<string, unknown>)) {
      const text = toCellString(value);
      if (!tab.header.includes(column) || text === null) return null;
      values[column] = text;
    }
    if (Object.keys(values).length === 0) return null;
    return { kind: "append", sheet: tab.title, values };
  }

  return null;
}

/** 적용 직전 검사. 구조가 어긋나면 invalid_proposal, 셀 값이 그 사이 바뀌었으면 conflict. */
export function validateProposal(tabs: SheetTab[], proposal: Proposal): { ok: true } | { ok: false; reason: "invalid_proposal" | "conflict" } {
  const tab = findEditableTab(tabs, proposal.sheet);
  if (!tab) return { ok: false, reason: "invalid_proposal" };

  if (proposal.kind === "update") {
    if (proposal.row < 2 || proposal.row > tab.rows.length || proposal.updates.length === 0) {
      return { ok: false, reason: "invalid_proposal" };
    }
    for (const update of proposal.updates) {
      const col = tab.header.indexOf(update.column);
      if (col < 0) return { ok: false, reason: "invalid_proposal" };
      const current = (tab.rows[proposal.row - 1]?.[col] ?? "").trim();
      if (current !== update.before.trim()) return { ok: false, reason: "conflict" };
    }
    return { ok: true };
  }

  const keys = Object.keys(proposal.values);
  if (keys.length === 0 || keys.some((key) => !tab.header.includes(key))) {
    return { ok: false, reason: "invalid_proposal" };
  }
  return { ok: true };
}

// ---- Sheets API ----

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

/** 설정 안내용. 관리자가 이 주소에 시트를 편집자로 공유해야 한다. */
export function serviceAccountEmail(): string | null {
  return loadServiceAccount()?.client_email ?? null;
}

function sheetsClient(): sheets_v4.Sheets {
  const account = loadServiceAccount();
  if (!account) throw new SheetError("not_configured");
  const auth = new google.auth.JWT({
    email: account.client_email,
    key: account.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function quoteTab(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (typeof code === "number") return code;
  if (typeof status === "number") return status;
  return undefined;
}

/** 모든 탭을 한 번의 batchGet으로 읽는다. 캐시 없음 — 항상 최신 시트 기준. */
export async function readSpreadsheet(sheetId: string): Promise<SheetTab[]> {
  const sheets = sheetsClient();
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets.properties.title" });
    const titles = (meta.data.sheets ?? [])
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => typeof title === "string" && title.length > 0);
    if (titles.length === 0) return [];

    const values = await sheets.spreadsheets.values.batchGet({ spreadsheetId: sheetId, ranges: titles.map(quoteTab) });
    const ranges = values.data.valueRanges ?? [];

    let total = 0;
    const tabs = titles.map((title, index) => {
      const rows = (ranges[index]?.values ?? []).map((row) =>
        (row as unknown[]).map((cell) => {
          const text = cell === null || cell === undefined ? "" : String(cell);
          total += text.length;
          return text;
        })
      );
      return { title, header: detectHeader(rows[0]), rows };
    });

    if (total > MAX_SHEET_CHARS) throw new SheetError("sheet_too_large");
    return tabs;
  } catch (error) {
    if (error instanceof SheetError) throw error;
    const status = statusOf(error);
    if (status === 403) throw new SheetError("sheet_forbidden");
    if (status === 404) throw new SheetError("sheet_not_found");
    console.warn("[sheets] read failed", error);
    throw new SheetError("sheet_read_failed");
  }
}

/** 적용 직전에 다시 읽어 충돌을 확인한 뒤 쓴다. */
export async function applyProposal(sheetId: string, proposal: Proposal): Promise<void> {
  const tabs = await readSpreadsheet(sheetId);
  const verdict = validateProposal(tabs, proposal);
  if (!verdict.ok) throw new SheetError(verdict.reason);

  const tab = tabs.find((entry) => entry.title === proposal.sheet) as SheetTab & { header: string[] };
  const sheets = sheetsClient();
  try {
    if (proposal.kind === "update") {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: proposal.updates.map((update) => ({
            range: `${quoteTab(tab.title)}!${columnToA1(tab.header.indexOf(update.column))}${proposal.row}`,
            values: [[update.after]],
          })),
        },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${quoteTab(tab.title)}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [tab.header.map((column) => proposal.values[column] ?? "")] },
      });
    }
  } catch (error) {
    console.warn("[sheets] write failed", error);
    throw new SheetError("sheet_write_failed");
  }
}
