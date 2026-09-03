import type { GameRow, CategoryLabelMaps } from "@/lib/categories";
import type { AttachmentWithUrl, InquiryFacetCounts, InquiryPage, InquiryRow } from "@/lib/inquiries";
import type { AccountHistoryEntry } from "@/lib/account-history";
import type { NoteRow } from "@/lib/notes";
import type { EventRow } from "@/lib/events";
import type { TemplateRow } from "@/lib/templates";
import type { MessageRow } from "@/lib/messages";
import type { InquiryListQuery } from "@/lib/inquiry-filters";
import { buildTimeline } from "@/lib/timeline";
import InboxNav from "@/components/inbox/InboxNav";
import InboxList from "@/components/inbox/InboxList";
import InboxConversation from "@/components/inbox/InboxConversation";
import InboxDetailPanel from "@/components/inbox/InboxDetailPanel";
import InboxEmptyState from "@/components/inbox/InboxEmptyState";

export interface InboxSelection {
  inquiry: InquiryRow;
  attachments: AttachmentWithUrl[];
  history: AccountHistoryEntry[];
  notes: NoteRow[];
  events: EventRow[];
  templates: TemplateRow[];
  messages: MessageRow[];
  siblingIds: string[];
}

/** 목록 머리에 보여줄 현재 보기 이름. */
export function describeView(query: InquiryListQuery): string {
  if (query.stale) return "3일 이상 미처리";
  switch (query.status) {
    case "new":
      return "접수";
    case "in_progress":
      return "처리중";
    case "resolved":
      return "완료";
    default:
      return "전체";
  }
}

/** 4단 배치. 게임 레일은 관리자 layout이 그리므로 여기에는 보기·목록·대화·상세만 있다. */
export default function InboxShell({
  game,
  query,
  labels,
  counts,
  listPage,
  selected,
}: {
  game: GameRow;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  counts: InquiryFacetCounts | null;
  listPage: InquiryPage;
  selected: InboxSelection | null;
}) {
  const selectedId = selected?.inquiry.id ?? null;

  return (
    <div className="flex h-screen min-w-[1180px] flex-1">
      <InboxNav game={game} query={query} labels={labels} counts={counts} selectedId={selectedId} />
      <InboxList gameId={game.id} page={listPage} query={query} labels={labels} selectedId={selectedId} viewLabel={describeView(query)} />
      {selected ? (
        <>
          <InboxConversation
            gameId={game.id}
            inquiry={selected.inquiry}
            labels={labels}
            query={query}
            siblingIds={selected.siblingIds}
            entries={buildTimeline(selected.inquiry, selected.attachments, selected.messages, selected.notes)}
            templates={selected.templates}
          />
          <InboxDetailPanel inquiry={selected.inquiry} events={selected.events} history={selected.history} />
        </>
      ) : (
        <InboxEmptyState />
      )}
    </div>
  );
}
