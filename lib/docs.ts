/**
 * 운영 어시스턴트의 구글 문서 읽기(읽기 전용). 본문을 문단·표 단위의 텍스트로 만든다.
 */
import { google, type docs_v1 } from "googleapis";
import { googleAuth, SheetError } from "@/lib/google-auth";

const HEADING_PREFIX: Record<string, string> = {
  HEADING_1: "# ",
  HEADING_2: "## ",
  HEADING_3: "### ",
};

function paragraphText(paragraph: docs_v1.Schema$Paragraph): string {
  return (paragraph.elements ?? [])
    .map((element) => element.textRun?.content ?? "")
    .join("")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphLine(paragraph: docs_v1.Schema$Paragraph): string | null {
  const text = paragraphText(paragraph);
  if (!text) return null;
  const heading = HEADING_PREFIX[paragraph.paragraphStyle?.namedStyleType ?? ""] ?? "";
  if (heading) return `${heading}${text}`;
  if (paragraph.bullet) return `- ${text}`;
  return text;
}

function cellText(cell: docs_v1.Schema$TableCell): string {
  return (cell.content ?? [])
    .map((element) => (element.paragraph ? paragraphText(element.paragraph) : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\|/g, " ");
}

/** 문단은 줄로, 표는 `|` 행으로. 구역 구분·목차·그림은 건너뛴다. */
export function serializeDocument(document: docs_v1.Schema$Document): string {
  const lines: string[] = [];
  for (const element of document.body?.content ?? []) {
    if (element.paragraph) {
      const line = paragraphLine(element.paragraph);
      if (line) lines.push(line);
    } else if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        const cells = (row.tableCells ?? []).map(cellText);
        if (cells.some(Boolean)) lines.push(cells.join(" | "));
      }
    }
  }
  return lines.join("\n");
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (typeof code === "number") return code;
  if (typeof status === "number") return status;
  return undefined;
}

export async function readDocument(docId: string): Promise<{ title: string; text: string }> {
  const docs = google.docs({ version: "v1", auth: googleAuth() });
  try {
    const response = await docs.documents.get({ documentId: docId });
    const title = response.data.title?.trim() || docId;
    return { title, text: serializeDocument(response.data) };
  } catch (error) {
    if (error instanceof SheetError) throw error;
    const status = statusOf(error);
    if (status === 403) throw new SheetError("source_forbidden");
    if (status === 404) throw new SheetError("source_not_found");
    console.warn("[docs] read failed", error);
    throw new SheetError("source_read_failed");
  }
}
