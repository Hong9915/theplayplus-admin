import type { AttachmentWithUrl, InquiryRow } from "@/lib/inquiries";
import type { MessageRow } from "@/lib/messages";
import type { NoteRow } from "@/lib/notes";

export type TimelineEntry =
  | { kind: "inquiry"; id: string; at: string; author: string | null; body: string; attachments: AttachmentWithUrl[] }
  | { kind: "outbound"; id: string; at: string; author: string | null; body: string }
  | { kind: "inbound"; id: string; at: string; author: string | null; body: string }
  | { kind: "note"; id: string; at: string; author: string; body: string };

/**
 * 문의 본문, 보낸 답변, 사용자 회신, 내부 메모를 대화 한 줄기로 합친다.
 * 본문은 항상 첫 항목이고 나머지는 시각 오름차순. 같은 시각이면 입력 순서
 * (메시지 → 메모)를 지킨다 — Array.prototype.sort는 안정 정렬이다.
 */
export function buildTimeline(
  inquiry: InquiryRow,
  attachments: AttachmentWithUrl[],
  messages: MessageRow[],
  notes: NoteRow[]
): TimelineEntry[] {
  const head: TimelineEntry = {
    kind: "inquiry",
    id: inquiry.id,
    at: inquiry.createdAt,
    author: inquiry.gameAccount,
    body: inquiry.content,
    attachments,
  };

  const rest: TimelineEntry[] = [
    ...messages.map(
      (message): TimelineEntry => ({
        kind: message.direction,
        id: message.id,
        at: message.sentAt,
        author: message.authorEmail,
        body: message.body,
      })
    ),
    ...notes.map(
      (note): TimelineEntry => ({
        kind: "note",
        id: note.id,
        at: note.createdAt,
        author: note.authorEmail,
        body: note.content,
      })
    ),
  ];

  rest.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return [head, ...rest];
}
