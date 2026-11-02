import type { GameRow, CategoryLabelMaps } from "@/lib/categories";
import type { AttachmentWithUrl, InquiryFacetCounts, InquiryPage, InquiryRow } from "@/lib/inquiries";
import type { AccountHistoryEntry } from "@/lib/account-history";
import type { NoteRow } from "@/lib/notes";
import type { EventRow } from "@/lib/events";
import type { MessageRow } from "@/lib/messages";
import { inquiryListHref, type InquiryListQuery } from "@/lib/inquiry-filters";
import { buildAccountTimeline, type AccountThread } from "@/lib/timeline";
import type { InboxScope } from "@/lib/inbox-scope";
import InboxTopBar from "@/components/inbox/InboxTopBar";
import InboxList from "@/components/inbox/InboxList";
import InboxConversation from "@/components/inbox/InboxConversation";
import InboxDetailPanel from "@/components/inbox/InboxDetailPanel";
import InboxEmptyState from "@/components/inbox/InboxEmptyState";

export interface InboxSelection {
  inquiry: InquiryRow;
  attachments: AttachmentWithUrl[];
  /** 계정 이력. 서비스 문의는 게임 계정이 없어 null. */
  history: AccountHistoryEntry[] | null;
  notes: NoteRow[];
  events: EventRow[];
  messages: MessageRow[];
  siblingIds: string[];
  /** 같은 게임·같은 계정의 다른 문의와 그 대화. 접수 순 정렬은 buildAccountTimeline이 한다. */
  pastThreads: AccountThread[];
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

/**
 * 상단 바 아래에 목록·대화·상세가 한 장의 둥근 작업면으로 붙는다. 게임 레일은 관리자 layout이 그린다.
 * 테두리 대신 면의 명도로 나눈다: 목록·상세는 옅은 회색(well), 대화는 그림자를 가진 흰 종이로 가장 앞에.
 */
export default function InboxShell({
  scope,
  title,
  game,
  query,
  labels,
  counts,
  listPage,
  selected,
  loungeUnread,
}: {
  scope: InboxScope;
  title: string;
  game: GameRow | null;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  counts: InquiryFacetCounts | null;
  listPage: InquiryPage;
  selected: InboxSelection | null;
  loungeUnread?: number | null;
}) {
  const selectedId = selected?.inquiry.id ?? null;

  return (
    <div className="flex flex-col h-dvh md:min-w-[1180px] flex-1 min-w-0">
      <InboxTopBar scope={scope} title={title} game={game} query={query} counts={counts} selectedId={selectedId} loungeUnread={loungeUnread} />
      <div className="flex flex-1 min-h-0 md:mx-2.5 md:mb-2.5 md:rounded-2xl overflow-hidden ring-1 ring-line-soft">
        <InboxList scope={scope} page={listPage} query={query} labels={labels} counts={counts} selectedId={selectedId} viewLabel={describeView(query)} now={Date.now()} />
        {selected ? (
          <>
            <InboxConversation
              scope={scope}
              inquiry={selected.inquiry}
              labels={labels}
              listHref={inquiryListHref(scope, query)}
              query={query}
              siblingIds={selected.siblingIds}
              entries={buildAccountTimeline(
                [
                  ...selected.pastThreads,
                  { inquiry: selected.inquiry, attachments: selected.attachments, messages: selected.messages, notes: selected.notes },
                ],
                selected.inquiry.id
              )}
            />
            <InboxDetailPanel
              inquiry={selected.inquiry}
              events={selected.events}
              history={selected.history}
              afterDeleteHref={inquiryListHref(scope, query)}
            />
          </>
        ) : (
          <InboxEmptyState />
        )}
      </div>
    </div>
  );
}
