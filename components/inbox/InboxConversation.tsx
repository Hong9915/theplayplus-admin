import type { InquiryRow } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import type { TimelineEntry } from "@/lib/timeline";
import type { InquiryListQuery } from "@/lib/inquiry-filters";
import type { InboxScope } from "@/lib/inbox-scope";
import { formatElapsed, formatReceivedAt } from "@/lib/format";
import StatusBadge from "@/components/ui/StatusBadge";
import ResolveButton from "@/components/inquiries/ResolveButton";
import SyncRepliesButton from "@/components/inquiries/SyncRepliesButton";
import InboxPrevNext from "@/components/inbox/InboxPrevNext";
import MarkReadOnOpen from "@/components/inbox/MarkReadOnOpen";
import InboxTimeline from "@/components/inbox/InboxTimeline";
import ReplyComposer from "@/components/inbox/ReplyComposer";

/** 가운데 열: 헤더(제목·상태·이동·완료) / 타임라인 / 작성란. */
export default function InboxConversation({
  scope,
  inquiry,
  labels,
  query,
  siblingIds,
  entries,
}: {
  scope: InboxScope;
  inquiry: InquiryRow;
  labels: CategoryLabelMaps;
  query: InquiryListQuery;
  siblingIds: string[];
  entries: TimelineEntry[];
}) {
  const category = `${labels.groupLabels[inquiry.groupKey] ?? inquiry.groupKey} · ${labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey}`;
  const received = `접수 ${formatReceivedAt(inquiry.createdAt)} · 경과 ${formatElapsed(inquiry.createdAt)}`;
  return (
    <section className="flex-1 min-w-0 h-full bg-panel border-r border-line flex flex-col overflow-hidden" aria-label="대화">
      {inquiry.unreadReplyAt && <MarkReadOnOpen inquiryId={inquiry.id} />}
      <header className="flex items-center justify-between gap-4 h-16 px-5 border-b border-line shrink-0">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <span className="font-mono text-[13px] text-muted shrink-0">{inquiry.inquiryNo ?? "—"}</span>
            <h2 className="text-base font-bold truncate">{inquiry.title}</h2>
          </div>
          {/* 창이 좁아 폭이 모자라면 줄바꿈 대신 말줄임. 헤더 높이가 고정이라 줄이 늘면 위아래가 잘린다. */}
          <div className="flex items-center gap-2.5 min-w-0 text-xs text-muted">
            <StatusBadge status={inquiry.status} />
            <span className="truncate" title={category}>
              {category}
            </span>
            <span className="truncate" title={received}>
              {received}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <InboxPrevNext scope={scope} inquiryId={inquiry.id} query={query} ids={siblingIds} />
          {inquiry.gmailThreadId && <SyncRepliesButton inquiryId={inquiry.id} />}
          <ResolveButton inquiryId={inquiry.id} currentStatus={inquiry.status} />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-ground px-6 py-5">
        <InboxTimeline entries={entries} labels={labels} />
      </div>

      <ReplyComposer
        inquiryId={inquiry.id}
        replyEmail={inquiry.replyEmail}
        initialDraft={inquiry.draftReply}
      />
    </section>
  );
}
