"use client";

import { useState, type ReactNode } from "react";
import type { InquiryRow } from "@/lib/inquiries";
import type { EventRow } from "@/lib/events";
import type { AccountHistoryEntry } from "@/lib/account-history";
import { describeEvent } from "@/lib/events";
import { emailLocalPart, formatReceivedAt, inquiryMetaRows } from "@/lib/format";
import StatusSelect from "@/components/inquiries/StatusSelect";
import PrioritySelect from "@/components/inquiries/PrioritySelect";
import AccountHistoryPanel from "@/components/inquiries/AccountHistoryPanel";

type Tab = "detail" | "history";

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

/** 오른쪽 상세 패널. 처리 컨트롤·접수 정보·처리 기록과 계정 이력을 탭으로. history가 null이면(서비스 문의) 탭 없이 상세만. */
export default function InboxDetailPanel({
  inquiry,
  events,
  history,
}: {
  inquiry: InquiryRow;
  events: EventRow[];
  history: AccountHistoryEntry[] | null;
}) {
  const [tab, setTab] = useState<Tab>("detail");
  const rows = inquiryMetaRows(inquiry);
  const showHistory = history !== null && tab === "history";

  const tabClass = (active: boolean) =>
    `h-8 px-3 inline-flex items-center gap-1.5 text-[13px] border-b-2 transition-colors ${
      active ? "border-ink text-ink font-semibold" : "border-transparent text-muted hover:text-ink"
    }`;

  return (
    <aside className="w-[300px] shrink-0 h-full bg-panel flex flex-col overflow-hidden" aria-label="문의 상세">
      {history !== null && (
        <div className="flex items-center gap-1 h-[52px] px-3 border-b border-line shrink-0" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "detail"} onClick={() => setTab("detail")} className={tabClass(tab === "detail")}>
            상세
          </button>
          <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")} className={tabClass(tab === "history")}>
            계정 이력
            <span className="inline-flex min-w-[18px] h-4 px-1.5 rounded-full bg-ground text-muted text-[11px] leading-4 justify-center font-normal">
              {history.length}
            </span>
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {!showHistory ? (
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
                    <dd className="text-right break-all">{row.value}</dd>
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
                    <span className="flex-1">
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
        ) : (
          <div className="px-4 py-3.5">
            {inquiry.gameId !== null && (
              <AccountHistoryPanel history={history ?? []} gameAccount={inquiry.gameAccount} currentTypeKey={inquiry.typeKey} gameId={inquiry.gameId} frameless />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
