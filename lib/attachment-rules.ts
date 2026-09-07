/**
 * 어시스턴트 첨부 파일의 허용 규칙. 화면(파일 선택)과 서버(추출) 양쪽이 쓰므로
 * exceljs 같은 서버 전용 의존성 없이 순수하게 둔다.
 */
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
/** 대화 하나에 딸린 첨부 텍스트 합계. 시트(300,000자)와 함께 프롬프트에 들어간다. */
export const MAX_ATTACHMENT_TEXT_CHARS = 200_000;

export const TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "tsv", "json"]);
export const TABLE_EXTENSIONS = new Set(["xlsx"]);

export const SUPPORTED_ATTACHMENT_ACCEPT = [...TEXT_EXTENSIONS, ...TABLE_EXTENSIONS].map((ext) => `.${ext}`).join(",");

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isSupportedAttachment(name: string): boolean {
  const ext = extensionOf(name);
  return TEXT_EXTENSIONS.has(ext) || TABLE_EXTENSIONS.has(ext);
}
