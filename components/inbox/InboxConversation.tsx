import Link from "next/link";
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
import MobileDetailButton from "@/components/inbox/MobileDetailButton";

/** 가운데 열: 헤더(제목·상태·이동·완료) / 타임라인 / 작성란. */
export default function InboxConversation({
  scope,
  inquiry,
  labels,
  listHref,
  query,
  siblingIds,
  entries,
}: {
  scope: InboxScope;
  inquiry: InquiryRow;
  labels: CategoryLabelMaps;
  /** 모바일 "‹ 목록" 버튼이 돌아갈 같은 필터의 목록 URL. */
  listHref: string;
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
      <header className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-4 md:px-[22px] pt-2 md:pt-4 pb-3 md:pb-3.5 border-b border-line-soft shrink-0">
        {/* 모바일은 목록과 대화가 한 화면씩이라 돌아가는 길과 상세 열기를 맨 위 줄에 둔다. */}
        <div className="md:hidden flex items-center justify-between -mx-2">
          <Link
            href={listHref}
            className="flex items-center gap-0.5 h-9 pl-1 pr-2.5 rounded-[9px] text-[13.5px] font-semibold text-ink-2 hover:bg-line-soft active:bg-line transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 6-6 6 6 6" />
            </svg>
            목록
          </Link>
          <MobileDetailButton />
        </div>
        {/* 폭이 모자라면 줄바꿈 대신 말줄임. 제목 줄이 따로 있어 메타 줄은 한 줄로 둔다. */}
        <div className="flex items-center gap-2 min-w-0 text-[12.5px] text-muted">
          <span className="font-bold text-ink-2 shrink-0">{inquiry.inquiryNo ?? "—"}</span>
          <StatusBadge status={inquiry.status} />
          <span className="hidden md:inline truncate" title={category}>
            {category}
          </span>
          <span className={`flex items-center gap-1.5 min-w-0 font-semibold ${HEAT_TEXT[heat]}`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${HEAT_BG[heat]}`} title={HEAT_LABELS[heat]} aria-hidden="true" />
            <span className="truncate" title={received}>
              {received}
            </span>
          </span>
        </div>
        {/* 모바일은 처리 버튼이 제목 아래 한 줄로 내려간다. */}
        <div className="order-last md:order-none md:row-span-2 flex flex-wrap items-start gap-1.5 shrink-0">
          {/* 모바일은 폭이 모자라 이전/다음을 빼고 목록으로 돌아가서 고른다. */}
          <div className="hidden md:contents">
            <InboxPrevNext scope={scope} inquiryId={inquiry.id} query={query} ids={siblingIds} />
          </div>
          {inquiry.gmailThreadId && <SyncRepliesButton inquiryId={inquiry.id} />}
          <ResolveButton inquiryId={inquiry.id} currentStatus={inquiry.status} />
        </div>
        <h2 className="text-[17px] md:text-[21px] leading-[1.3] font-bold tracking-[-.025em] line-clamp-2">{inquiry.title}</h2>
      </header>

      <div className="flex-1 overflow-y-auto bg-thread px-3 md:px-7 pt-4 md:pt-[22px] pb-5 md:pb-7">
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
