/**
 * 답변·회신 첨부의 규칙. 화면(작성란)과 서버(업로드 주소 발급·발송·회신 동기화)가 같이 쓴다.
 * 첨부 버킷 `inquiry-attachments`는 이미지 네 종류와 PDF·엑셀(마이그레이션 0038)을 파일당
 * 5MB까지 받는다. 다른 종류는 여기서 먼저 거르고, 5MB를 넘는 사진은 JPEG로 줄여 올린다
 * (작성란은 lib/shrink-image.ts, 회신 동기화는 lib/shrink-image-server.ts). 문서는 줄일 수
 * 없어 5MB를 넘으면 거절한다. 문서는 우리가 보내는 답변에만 붙인다 — 회신 동기화는 사진만 저장한다.
 */
export const ATTACHMENT_BUCKET = "inquiry-attachments";

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** 답변에 붙일 수 있는 문서. 확장자는 브라우저가 형식을 비워 줄 때 대신 본다. */
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
] as const;
export type AllowedDocumentType = (typeof ALLOWED_DOCUMENT_TYPES)[number];

/** 답변 첨부로 받는 형식 전체(사진 + 문서). */
export type AllowedReplyType = AllowedImageType | AllowedDocumentType;
export const ALLOWED_REPLY_TYPES: readonly AllowedReplyType[] = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOCUMENT_TYPES];

const DOCUMENT_TYPE_BY_EXTENSION: Record<string, AllowedDocumentType> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

/** 파일 선택창의 accept. 형식을 모르는 브라우저를 위해 확장자도 넣는다. */
export const REPLY_FILE_ACCEPT = [...ALLOWED_REPLY_TYPES, ...Object.keys(DOCUMENT_TYPE_BY_EXTENSION).map((ext) => `.${ext}`)].join(",");

/** 버킷의 file_size_limit과 같다. 이보다 큰 사진은 JPEG로 줄여서 저장한다. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * 회신 사진을 줄이려고 내려받는 원본의 상한. Gmail이 메일 하나를 25MB까지만 받으므로
 * 사실상 모든 첨부 사진이 들어온다. 이보다 크면(드라이브 링크 등) 내려받지 않는다.
 */
export const MAX_INBOUND_SOURCE_BYTES = 25 * 1024 * 1024;

/** 답변 한 번에 붙일 수 있는 파일 수(사진·문서 합쳐서). */
export const MAX_REPLY_IMAGES = 5;

/**
 * 답변 한 번의 사진 합계. Gmail은 메일 하나를 25MB까지 받는데 base64로 1.37배 커지고
 * 본문·로고도 들어가므로 여유를 둔다.
 */
export const MAX_REPLY_TOTAL_BYTES = 15 * 1024 * 1024;

export function isAllowedImageType(type: string | null | undefined): type is AllowedImageType {
  return !!type && (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type.toLowerCase());
}

export function isAllowedDocumentType(type: string | null | undefined): type is AllowedDocumentType {
  return !!type && (ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(type.toLowerCase());
}

export function isAllowedReplyType(type: string | null | undefined): type is AllowedReplyType {
  return isAllowedImageType(type) || isAllowedDocumentType(type);
}

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

function documentTypeOf(name: string): AllowedDocumentType | null {
  const ext = extensionOf(name);
  return Object.prototype.hasOwnProperty.call(DOCUMENT_TYPE_BY_EXTENSION, ext) ? DOCUMENT_TYPE_BY_EXTENSION[ext] : null;
}

/**
 * 답변에 붙일 파일의 형식. 브라우저가 알려 준 형식이 허용 목록에 있으면 그대로 쓰고,
 * 비었거나 octet-stream이면(엑셀이 없는 PC 등) 확장자로 문서 형식을 정한다. 못 받으면 null.
 */
export function replyFileType(name: string, type: string): AllowedReplyType | null {
  const lowered = type.toLowerCase();
  if (isAllowedReplyType(lowered)) return lowered;
  if (lowered === "" || lowered === "application/octet-stream") return documentTypeOf(name);
  return null;
}

/** 말풍선에서 그림 대신 파일 칩으로 보여줄 첨부인지. 저장된 이름의 확장자로 정한다. */
export function isDocumentFileName(name: string): boolean {
  return documentTypeOf(name) !== null;
}

const EXTENSION_BY_TYPE: Record<AllowedReplyType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
};

/**
 * 저장 경로에 넣을 파일 이름. Supabase Storage는 키에 한글·공백을 받지 않아(InvalidKey,
 * 2026-10-31 실측) 웹 접수 폼처럼 영문·숫자·`._-`만 남긴다. 화면과 메일에 보이는 원래
 * 이름은 inquiry_attachments.file_name에 따로 저장한다. 남는 글자가 없으면 확장자로 만든다.
 */
export function safeFileName(name: string | null | undefined, type: AllowedReplyType): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(-100);
  if (/[A-Za-z0-9]/.test(cleaned.replace(/\.[A-Za-z0-9]+$/, ""))) return cleaned;
  return `${isAllowedImageType(type) ? "image" : "file"}.${EXTENSION_BY_TYPE[type]}`;
}

/** 답변·회신 첨부의 저장 경로. 문의 id 아래에 두어 문의 삭제 때 같이 정리된다. */
export function messageAttachmentPath(inquiryId: string, fileName: string, uuid: string): string {
  return `${inquiryId}/messages/${uuid}-${fileName}`;
}

/** 이 문의의 답변 첨부 경로인지. 다른 문의의 파일을 경로만 알고 붙여 보내지 못하게 한다. */
export function isMessageAttachmentPathOf(inquiryId: string, path: string): boolean {
  return path.startsWith(`${inquiryId}/messages/`) && !path.includes("..");
}
