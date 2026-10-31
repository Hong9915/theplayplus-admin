/**
 * 답변·회신 사진의 규칙. 화면(작성란)과 서버(업로드 주소 발급·발송·회신 동기화)가 같이 쓴다.
 * 첨부 버킷 `inquiry-attachments`는 이미지 네 종류와 파일당 5MB만 받는다(버킷 설정,
 * 2026-10-31 확인). 그 밖의 파일은 버킷에 올라가지 않으므로 여기서 먼저 거른다.
 */
export const ATTACHMENT_BUCKET = "inquiry-attachments";

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** 버킷의 file_size_limit과 같다. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 답변 한 번에 붙일 수 있는 사진 수. */
export const MAX_REPLY_IMAGES = 5;

/**
 * 답변 한 번의 사진 합계. Gmail은 메일 하나를 25MB까지 받는데 base64로 1.37배 커지고
 * 본문·로고도 들어가므로 여유를 둔다.
 */
export const MAX_REPLY_TOTAL_BYTES = 15 * 1024 * 1024;

export function isAllowedImageType(type: string | null | undefined): type is AllowedImageType {
  return !!type && (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type.toLowerCase());
}

const EXTENSION_BY_TYPE: Record<AllowedImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * 저장 경로에 넣을 파일 이름. Supabase Storage는 키에 한글·공백을 받지 않아(InvalidKey,
 * 2026-10-31 실측) 웹 접수 폼처럼 영문·숫자·`._-`만 남긴다. 화면과 메일에 보이는 원래
 * 이름은 inquiry_attachments.file_name에 따로 저장한다. 남는 글자가 없으면 확장자로 만든다.
 */
export function safeFileName(name: string | null | undefined, type: AllowedImageType): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(-100);
  return /[A-Za-z0-9]/.test(cleaned.replace(/\.[A-Za-z0-9]+$/, "")) ? cleaned : `image.${EXTENSION_BY_TYPE[type]}`;
}

/** 답변·회신 사진의 저장 경로. 문의 id 아래에 두어 문의 삭제 때 같이 정리된다. */
export function messageAttachmentPath(inquiryId: string, fileName: string, uuid: string): string {
  return `${inquiryId}/messages/${uuid}-${fileName}`;
}

/** 이 문의의 답변 사진 경로인지. 다른 문의의 파일을 경로만 알고 붙여 보내지 못하게 한다. */
export function isMessageAttachmentPathOf(inquiryId: string, path: string): boolean {
  return path.startsWith(`${inquiryId}/messages/`) && !path.includes("..");
}
