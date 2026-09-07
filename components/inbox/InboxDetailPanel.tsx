"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { InquiryRow } from "@/lib/inquiries";
import type { EventRow } from "@/lib/events";
import type { AccountHistoryEntry } from "@/lib/account-history";
import { describeEvent } from "@/lib/events";
import { emailLocalPart, formatReceivedAt, inquiryMetaRows } from "@/lib/format";
import { handleTabListKeyDown, tabPanelProps, tabProps } from "@/components/ui/tabs";
import StatusSelect from "@/components/inquiries/StatusSelect";
import PrioritySelect from "@/components/inquiries/PrioritySelect";
import AccountHistoryPanel from "@/components/inquiries/AccountHistoryPanel";

type Tab = "detail" | "history";
const TABS: readonly Tab[] = ["detail", "history"];
const TAB_PREFIX = "inbox-detail";
const TAB_PARAM = "tab";

const DOT: Record<EventRow["kind"], string> = {
  status_changed: "bg-ink",
  priority_changed: "bg-amber-600",
  reply_sent: "bg-ink",
  auto_reply_sent: "bg-ink",
  note_added: "bg-amber-600",
};

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-semibold text-muted">{children}</h2>;
}

/**
 * 오른콽 상세 패널. 처리 컨트롤·접수 정보·처리 기록과 계정 이력을 탭으로. history가 null이면(서비스 문의) 탭 없이 상세만.
 * 열린 탭은 URL의 ?tab=history 로 남겨 링크를 공유하거나 새로 고쳐도 같은 탭이 열린다.
 */
export default function InboxDetailPanel({
  inquiry,
  events,
  history,
}: {
  inquiry: InquiryRow;
  events: EventRow[];
  history: AccountHistoryEntry[] | null;
}) {
  const searchParams = useSearchParams();
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
    `h-8 px-3 inline-flex items-center gap-1.5 text-[13px] border-b-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-t-md ${
      active ? "border-ink text-ink font-semibold" : "border-transparent text-muted hover:text-ink"
    }`;

  const detail = (
    <>
      <section className="px-4 py-3.5 border-b border-line flex flex-col gap-2.5">
        <SectionTitle>처리</SectionTitle>
        <StatusSelect inquiryId={inquiry.id} currentStatus={inquiry.status} />
        <PrioritySelect inquiryId={inquiry.id} currentPriority={inquiry.priority} />
      </section>

      <section className="px-4 py-3.5 border-b border-line flex flex-col gap-2">
        <SectionTitle>접수 정보</SectionTitle>
        <dl className="flex flex-col gap-1.5 text-[13px]">
          {rows.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-3">
              <dt className="text-muted shrink-0">{row.label}</dt>
              <dd className="text-right min-w-0 break-words">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="px-4 py-3.5 flex flex-col gap-2">
        <SectionTitle>처리 기록</SectionTitle>
        <ol className="flex flex-col gap-2 text-xs">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-2.5">
              <span className={`w-1.5 h-1.5 rounded-full mt-[5px] shrink-0 ${DOT[event.kind]}`} aria-hidden="true" />
              <span className="flex-1 min-w-0 break-words">
                {describeEvent(event)}{" "}
                <span className="text-muted" title={event.actorEmail}>
                  · {emailLocalPart(event.actorEmail)}
                </span>
              </span>
              <span className="text-muted font-mono text-[11px] shrink-0">{formatReceivedAt(event.createdAt)}</span>
            </li>
          ))}
          {/* 접수 이벤트는 저장하지 않는다. created_at이 같은 정보를 갖고 있다. */}
          <li className="flex items-start gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full mt-[5px] shrink-0 bg-accent" aria-hidden="true" />
            <span className="flex-1">접수</span>
            <span className="text-muted font-mono text-[11px] shrink-0">{formatReceivedAt(inquiry.createdAt)}</span>
          </li>
        </ol>
      </section>
    </>
  );

  return (
    <aside className="w-[300px] shrink-0 h-full bg-panel flex flex-col overflow-hidden" aria-label="문의 상세">
      {history !== null && (
        <div
          className="flex items-center gap-1 h-[52px] px-3 border-b border-line shrink-0"
          role="tablist"
          aria-label="상세 보기"
          onKeyDown={(event) => handleTabListKeyDown(event, TABS, tab, TAB_PREFIX, changeTab)}
        >
          <button {...tabProps(TAB_PREFIX, "detail", tab === "detail")} onClick={() => changeTab("detail")} className={tabClass(tab === "detail")}>
            상세
          </button>
          <button {...tabProps(TAB_PREFIX, "history", tab === "history")} onClick={() => changeTab("history")} className={tabClass(tab === "history")}>
            계정 이력
            <span className="inline-flex min-w-[18px] h-4 px-1.5 rounded-full bg-ground text-muted text-[11px] leading-4 justify-center font-normal tabular-nums">
              {history.length}
            </span>
          </button>
        </div>
      )}

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
