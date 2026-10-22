"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { InquiryRow } from "@/lib/inquiries";
import type { EventRow } from "@/lib/events";
import type { AccountHistoryEntry } from "@/lib/account-history";
import { describeEvent } from "@/lib/events";
import { emailLocalPart, formatReceivedAt, inquiryMetaRows } from "@/lib/format";
import { handleTabListKeyDown, tabPanelProps, tabProps } from "@/components/ui/tabs";
import { usePersistedBoolean } from "@/components/ui/usePersistedBoolean";
import StatusSelect from "@/components/inquiries/StatusSelect";
import PrioritySelect from "@/components/inquiries/PrioritySelect";
import AccountHistoryPanel from "@/components/inquiries/AccountHistoryPanel";
import DeleteInquiryButton from "@/components/inquiries/DeleteInquiryButton";

type Tab = "detail" | "history";
const TABS: readonly Tab[] = ["detail", "history"];
const TAB_PREFIX = "inbox-detail";
const TAB_PARAM = "tab";
const COLLAPSE_KEY = "inbox-detail-collapsed";

const DOT: Record<EventRow["kind"], string> = {
  status_changed: "border-ink-2",
  priority_changed: "border-heat-hot",
  reply_sent: "border-ink-2",
  auto_reply_sent: "border-muted",
  note_added: "border-memo-line",
};

const ICON_BTN =
  "w-[30px] h-[30px] shrink-0 flex items-center justify-center rounded-lg text-ink-2 hover:bg-line-soft hover:text-ink active:bg-line transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

function PanelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </svg>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-[13px] font-bold tracking-[-.01em] text-ink-2">{children}</h2>;
}

/**
 * 오른콽 상세 패널. 처리 컨트롤·접수 정보·처리 기록과 계정 이력을 탭으로. history가 null이면(서비스 문의) 탭 없이 상세만.
 * 열린 탭은 URL의 ?tab=history 로 남겨 링크를 공유하거나 새로 고쳐도 같은 탭이 열린다.
 */
export default function InboxDetailPanel({
  inquiry,
  events,
  history,
  afterDeleteHref,
}: {
  inquiry: InquiryRow;
  events: EventRow[];
  history: AccountHistoryEntry[] | null;
  /** 문의를 지운 뒤 돌아갈 목록 URL. */
  afterDeleteHref: string;
}) {
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = usePersistedBoolean(COLLAPSE_KEY, false);
  const [tab, setTab] = useState<Tab>(history !== null && searchParams?.get(TAB_PARAM) === "history" ? "history" : "detail");
  const rows = inquiryMetaRows(inquiry);
  const showHistory = history !== null && tab === "history";

  function changeTab(next: Tab) {
    setTab(next);
    // 서버 왕복 없이 URL만 맞춘다. Next 14.1+는 replaceState를 라우터 상태와 동기화한다.
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (next === "history") params.set(TAB_PARAM, "history");
    else params.delete(TAB_PARAM);
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }

  const tabClass = (active: boolean) =>
    `h-9 px-2.5 -mb-px inline-flex items-center gap-1.5 text-[13.5px] font-semibold border-b-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-t-md ${
      active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
    }`;

  const detail = (
    <>
      <section className="px-4 pt-4 pb-5 flex flex-col gap-2.5">
        <SectionTitle>처리</SectionTitle>
        <StatusSelect inquiryId={inquiry.id} currentStatus={inquiry.status} />
        <PrioritySelect inquiryId={inquiry.id} currentPriority={inquiry.priority} />
      </section>

      <section className="px-4 pb-5 flex flex-col gap-2.5">
        <SectionTitle>접수 정보</SectionTitle>
        <dl className="flex flex-col gap-2 text-[13px]">
          {rows.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-3">
              <dt className="text-muted shrink-0">{row.label}</dt>
              <dd className="text-right min-w-0 break-words font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="px-4 pb-6 flex flex-col gap-2.5">
        <SectionTitle>처리 기록</SectionTitle>
        {/* 세로선 위에 속이 빈 점. 점 색이 어떤 기록인지 알려 준다. */}
        <ol className="flex flex-col gap-3 ml-1 pl-3.5 border-l-2 border-line text-[13px]">
          {events.map((event) => (
            <li key={event.id} className="relative flex items-start gap-2.5">
              <span className={`absolute -left-[21px] top-[5px] w-2.5 h-2.5 rounded-full bg-well border-2 ${DOT[event.kind]}`} aria-hidden="true" />
              <span className="flex-1 min-w-0 break-words">
                {describeEvent(event)}{" "}
                <span className="text-muted" title={event.actorEmail}>
                  · {emailLocalPart(event.actorEmail)}
                </span>
              </span>
              <span className="text-muted text-[12px] tabular-nums shrink-0">{formatReceivedAt(event.createdAt)}</span>
            </li>
          ))}
          {/* 접수 이벤트는 저장하지 않는다. created_at이 같은 정보를 갖고 있다. */}
          <li className="relative flex items-start gap-2.5">
            <span className="absolute -left-[21px] top-[5px] w-2.5 h-2.5 rounded-full bg-well border-2 border-accent" aria-hidden="true" />
            <span className="flex-1">접수</span>
            <span className="text-muted text-[12px] tabular-nums shrink-0">{formatReceivedAt(inquiry.createdAt)}</span>
          </li>
        </ol>
      </section>

      <section className="px-4 pb-6 pt-4 border-t border-line-soft">
        <DeleteInquiryButton inquiryId={inquiry.id} inquiryNo={inquiry.inquiryNo} afterDeleteHref={afterDeleteHref} />
      </section>
    </>
  );

  if (collapsed) {
    return (
      <aside className="w-12 shrink-0 h-full bg-well flex flex-col items-center pt-3" aria-label="문의 상세 (접힘)">
        <button type="button" onClick={() => setCollapsed(false)} aria-label="상세 펼치기" title="상세 펼치기" className={ICON_BTN}>
          <PanelIcon />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-[304px] shrink-0 h-full bg-well flex flex-col overflow-hidden" aria-label="문의 상세">
      <div className="flex items-end gap-0.5 h-[52px] px-3 border-b border-line-soft shrink-0">
        {history !== null && (
          <div
            className="flex items-center gap-1 flex-1 min-w-0"
            role="tablist"
            aria-label="상세 보기"
            onKeyDown={(event) => handleTabListKeyDown(event, TABS, tab, TAB_PREFIX, changeTab)}
          >
            <button {...tabProps(TAB_PREFIX, "detail", tab === "detail")} onClick={() => changeTab("detail")} className={tabClass(tab === "detail")}>
              상세
            </button>
            <button {...tabProps(TAB_PREFIX, "history", tab === "history")} onClick={() => changeTab("history")} className={tabClass(tab === "history")}>
              계정 이력
              <span className="text-muted text-[12.5px] font-semibold tabular-nums">
                {history.length}
              </span>
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="상세 접기"
          title="상세 접기"
          className={`ml-auto mb-[11px] ${ICON_BTN}`}
        >
          <PanelIcon />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {history === null ? (
          detail
        ) : !showHistory ? (
          <div {...tabPanelProps(TAB_PREFIX, "detail")}>{detail}</div>
        ) : (
          <div {...tabPanelProps(TAB_PREFIX, "history")} className="px-4 py-3.5">
            {inquiry.gameId !== null && (
              <AccountHistoryPanel history={history} gameAccount={inquiry.gameAccount} currentTypeKey={inquiry.typeKey} gameId={inquiry.gameId} frameless />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
