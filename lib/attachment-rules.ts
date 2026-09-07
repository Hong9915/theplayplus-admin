/**
 * 어시스턴트 첨부 파일의 허용 규칙. 화면(파일 선택)과 서버(추출) 양쪽이 쓰므로
 * exceljs 같은 서버 전용 의존성 없이 순수하게 둔다.
 */
/**
 * 파일당·메시지당 4MB. 파일은 메시지와 한 요청으로 가는데 Vercel 서버리스 함수의
 * 요청 본문 상한이 4.5MB라 그 아래로 잡는다. 텍스트 합계 상한이 따로 있어 이보다
 * 큰 txt는 어차피 들어가지 못한다 — 이 값은 사실상 표 파일(xlsx)을 위한 것이다.
 */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_MESSAGE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
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
