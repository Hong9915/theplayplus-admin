import type { MessageRow } from "@/lib/assistant-store";

/** 화면에 보이는 첨부. 뽑아낸 텍스트는 서버에만 두고 이름·크기만 내려온다. */
export interface ChatAttachment {
  name: string;
  size: number;
}

/** 화면이 들고 있는 메시지. 서버 행에서 대화 id·시각·첨부 본문을 뺀 것. */
export type ChatMessage = Pick<MessageRow, "id" | "role" | "content" | "proposal" | "status" | "failureReason" | "appliedBy" | "appliedAt"> & {
  attachments: ChatAttachment[];
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 스트림 error 사유 → 안내. 무엇을 고쳐야 하는지 알려줘야 한다. */
export const STREAM_ERROR_MESSAGES: Record<string, string> = {
  not_configured: "OpenAI API 키 또는 서비스 계정이 설정되지 않았습니다.",
  source_forbidden: "시트를 읽을 권한이 없습니다. 시트 설정에 표시된 서비스 계정에 편집자로 공유했는지 확인하세요.",
  source_not_found: "시트를 찾을 수 없습니다. 시트 설정의 URL을 확인하세요.",
  sources_too_large: "시트가 너무 큽니다(300,000자 초과).",
  source_read_failed: "시트를 읽지 못했습니다. 잠시 후 다시 시도하세요.",
  model_failed: "응답을 받지 못했습니다. 다시 시도하세요.",
  invalid_proposal: "수정 제안을 만들지 못했습니다. 탭·열 이름을 정확히 알려주고 다시 시도하세요.",
  save_failed: "메시지를 저장하지 못했습니다.",
  unsupported_type: "지원하지 않는 형식입니다. txt, md, csv, tsv, json, xlsx만 붙일 수 있습니다.",
  file_too_large: "파일이 너무 큽니다. 파일당 4MB까지 붙일 수 있습니다.",
  message_too_large: "한 번에 보내는 파일 합계 4MB를 넘습니다. 나눠서 보내 주세요.",
  too_many_files: "파일은 한 번에 5개까지 붙일 수 있습니다.",
  attachments_too_large: "이 대화의 첨부 파일이 너무 많습니다. 새 대화에서 다시 올려 주세요.",
  file_unreadable: "파일을 읽지 못했습니다. 손상되지 않았는지 확인하세요.",
};

export const APPLY_FAILURE_MESSAGES: Record<string, string> = {
  conflict: "시트가 그 사이 바뀌었습니다. 다시 물어봐 주세요.",
  sheet_write_failed: "시트에 쓰지 못했습니다.",
  invalid_proposal: "제안이 시트 구조와 맞지 않습니다.",
  not_configured: "시트 연결 또는 서비스 계정 설정이 없습니다.",
  source_forbidden: "시트를 쓸 권한이 없습니다. 서비스 계정을 편집자로 공유했는지 확인하세요.",
};

export const GENERIC_ERROR = "요청에 실패했습니다.";
