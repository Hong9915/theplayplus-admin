import type { InquiryRow } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import type { TimelineEntry } from "@/lib/timeline";
import type { InquiryListQuery } from "@/lib/inquiry-filters";
import type { InboxScope } from "@/lib/inbox-scope";
import { formatElapsed, formatReceivedAt } from "@/lib/format";
import { HEAT_BG, HEAT_LABELS, HEAT_TEXT, heatLevel } from "@/lib/heat";
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
  const heat = heatLevel(inquiry.createdAt, inquiry.status);
  return (
    <section className="relative z-[1] flex-1 min-w-0 h-full bg-panel shadow-paper flex flex-col overflow-hidden" aria-label="대화">
      {inquiry.unreadReplyAt && <MarkReadOnOpen inquiryId={inquiry.id} />}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-[22px] pt-4 pb-3.5 border-b border-line-soft shrink-0">
        {/* 폭이 모자라면 줄바꿈 대신 말줄임. 제목 줄이 따로 있어 메타 줄은 한 줄로 둔다. */}
        <div className="flex items-center gap-2 min-w-0 text-[12.5px] text-muted">
          <span className="font-bold text-ink-2 shrink-0">{inquiry.inquiryNo ?? "—"}</span>
          <StatusBadge status={inquiry.status} />
          <span className="truncate" title={category}>
            {category}
          </span>
          <span className={`flex items-center gap-1.5 min-w-0 font-semibold ${HEAT_TEXT[heat]}`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${HEAT_BG[heat]}`} title={HEAT_LABELS[heat]} aria-hidden="true" />
            <span className="truncate" title={received}>
              {received}
            </span>
          </span>
        </div>
        <div className="row-span-2 flex items-start gap-1.5 shrink-0">
          <InboxPrevNext scope={scope} inquiryId={inquiry.id} query={query} ids={siblingIds} />
          {inquiry.gmailThreadId && <SyncRepliesButton inquiryId={inquiry.id} />}
          <ResolveButton inquiryId={inquiry.id} currentStatus={inquiry.status} />
        </div>
        <h2 className="text-[21px] leading-[1.3] font-bold tracking-[-.025em] line-clamp-2">{inquiry.title}</h2>
      </header>

      <div className="flex-1 overflow-y-auto bg-thread px-7 pt-[22px] pb-7">
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
