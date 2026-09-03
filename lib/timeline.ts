import type { AttachmentWithUrl, InquiryRow, InquiryStatus } from "@/lib/inquiries";
import type { MessageRow } from "@/lib/messages";
import type { NoteRow } from "@/lib/notes";

/** 타임라인을 만드는 데 필요한 문의 정보. 현재 문의(InquiryRow)와 계정 이력 항목 모두 여기에 맞춘다. */
export type ThreadInquiry = Pick<
  InquiryRow,
  "id" | "inquiryNo" | "title" | "content" | "typeKey" | "status" | "gameAccount" | "createdAt"
>;

/** 문의 하나와 거기에 딸린 첨부·메시지·메모. */
export interface AccountThread {
  inquiry: ThreadInquiry;
  attachments: AttachmentWithUrl[];
  messages: MessageRow[];
  notes: NoteRow[];
}

export type TimelineEntry =
  | {
      kind: "divider";
      id: string;
      at: string;
      inquiryNo: string | null;
      title: string;
      typeKey: string;
      status: InquiryStatus;
      current: boolean;
    }
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
  inquiry: ThreadInquiry,
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

/**
 * 같은 계정의 문의 여러 건을 채팅처럼 한 줄기로. 문의는 접수 순으로 늘어놓고,
 * 각 문의의 답변·회신·메모는 그 문의 구분선 아래에 모은다 (주제가 섞이지 않게).
 * 문의가 하나뿐이면 구분선을 넣지 않는다.
 */
export function buildAccountTimeline(threads: AccountThread[], currentInquiryId: string): TimelineEntry[] {
  const ordered = [...threads].sort(
    (a, b) => new Date(a.inquiry.createdAt).getTime() - new Date(b.inquiry.createdAt).getTime()
  );
  const entries: TimelineEntry[] = [];
  for (const thread of ordered) {
    if (ordered.length > 1) {
      entries.push({
        kind: "divider",
        id: thread.inquiry.id,
        at: thread.inquiry.createdAt,
        inquiryNo: thread.inquiry.inquiryNo,
        title: thread.inquiry.title,
        typeKey: thread.inquiry.typeKey,
        status: thread.inquiry.status,
        current: thread.inquiry.id === currentInquiryId,
      });
    }
    entries.push(...buildTimeline(thread.inquiry, thread.attachments, thread.messages, thread.notes));
  }
  return entries;
}
