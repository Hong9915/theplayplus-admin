"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InquiryPage, InquiryRow, InquiryStatus } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import { SORT_OPTIONS, inboxHref, inquiryHref, type InquiryListQuery } from "@/lib/inquiry-filters";
import type { InboxScope } from "@/lib/inbox-scope";
import StatusBadge from "@/components/ui/StatusBadge";
import StatusMessage from "@/components/ui/StatusMessage";
import { formatElapsed } from "@/lib/format";

const STATUS_OPTIONS: Array<{ value: InquiryStatus; label: string }> = [
  { value: "new", label: "접수" },
  { value: "in_progress", label: "처리중" },
  { value: "resolved", label: "완료" },
];

/** 보통·낮음은 소음이라 표시하지 않는다. */
const PRIORITY_MARK: Partial<Record<InquiryRow["priority"], { label: string; className: string }>> = {
  urgent: { label: "긴급", className: "text-red-600 font-semibold" },
  high: { label: "높음", className: "text-amber-600 font-medium" },
};

const SELECT =
  "bg-panel border border-line rounded-lg px-2 py-1 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent transition-colors";

const PAGE_BTN = "border border-line rounded-lg px-2 py-0.5 transition-colors";

function hasFilter(query: InquiryListQuery): boolean {
  return Boolean(query.group || query.type || query.status || query.priority || query.stale || query.unread || query.q);
}

function firstLine(content: string): string {
  return content.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

export default function InboxList({
  scope,
  page,
  query,
  labels,
  selectedId,
  viewLabel,
  now = Date.now(),
}: {
  scope: InboxScope;
  page: InquiryPage;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  selectedId: string | null;
  /** 머리에 보여줄 현재 보기 이름 (접수, 처리중, 전체 …). */
  viewLabel: string;
  /**
   * 경과 시간의 기준 시각(ms). 서버가 렌더한 값을 그대로 넘겨야 hydration 때 분 경계를
   * 넘어 서버·클라이언트 표시가 어긋나지 않는다.
   */
  now?: number;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<InquiryStatus>("resolved");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkFailed, setBulkFailed] = useState(false);
  // 클릭한 문의를 서버 응답 전에 먼저 강조한다. 서버가 그 문의를 선택으로 돌려주면 지운다.
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { rows, total, pageSize } = page;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstIndex = total === 0 ? 0 : (query.page - 1) * pageSize + 1;
  const lastIndex = Math.min(total, query.page * pageSize);
  const reference = new Date(now);

  // 서버가 준 목록이 바뀌면 체크는 의미를 잃는다.
  useEffect(() => {
    setChecked(new Set());
  }, [rows]);

  useEffect(() => {
    setPendingId(null);
  }, [selectedId]);

  const shownId = pendingId ?? selectedId;

  function markPending(inquiryId: string) {
    if (inquiryId === selectedId) return;
    setPendingId(inquiryId);
  }

  function navigate(next: Partial<InquiryListQuery>) {
    router.replace(inboxHref(scope, selectedId, { ...query, ...next, page: 1 }));
  }

  function pageHref(pageNo: number): string {
    return inboxHref(scope, selectedId, { ...query, page: pageNo });
  }

  const allChecked = rows.length > 0 && rows.every((row) => checked.has(row.id));

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(rows.map((row) => row.id)));
  }

  function toggleOne(id: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkStatus() {
    if (checked.size === 0) return;
    setBulkBusy(true);
    setBulkMessage(null);
    setBulkFailed(false);

    let json: { success: boolean; updated?: number };
    try {
      const response = await fetch("/api/inquiries/bulk-status", {
        method: "POST",
        body: JSON.stringify({ ids: Array.from(checked), status: bulkStatus }),
      });
      json = await response.json();
    } catch {
      setBulkBusy(false);
      setBulkFailed(true);
      setBulkMessage("상태 변경에 실패했습니다.");
      return;
    }
    setBulkBusy(false);

    if (!json.success) {
      setBulkFailed(true);
      setBulkMessage("상태 변경에 실패했습니다.");
      return;
    }
    setBulkMessage(`${json.updated ?? 0}건의 상태를 변경했습니다.`);
    setChecked(new Set());
    router.refresh();
  }

  return (
    <section className="w-[340px] shrink-0 h-full bg-panel border-r border-line flex flex-col overflow-hidden" aria-label="문의 목록">
      <header className="flex items-center justify-between gap-2 h-[52px] px-4 border-b border-line shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="이 페이지 전체 선택" className="accent-accent" />
          <span className="text-[13px] font-semibold truncate">
            <span>{viewLabel}</span> <span className="text-muted font-normal tabular-nums">{total}건</span>
          </span>
        </div>
        <select
          value={query.sort}
          onChange={(e) => navigate({ sort: e.target.value as InquiryListQuery["sort"] })}
          className={SELECT}
          aria-label="정렬"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </header>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {hasFilter(query) ? "조건에 맞는 문의가 없습니다." : "접수된 문의가 없습니다."}
          </p>
        ) : (
          <ul>
            {rows.map((inquiry) => {
              const elapsed = formatElapsed(inquiry.createdAt, reference);
              const stale = inquiry.status !== "resolved" && elapsed.endsWith("일");
              const selected = inquiry.id === shownId;
              const pending = pendingId !== null && inquiry.id === pendingId;
              const priority = PRIORITY_MARK[inquiry.priority];
              const href = inquiryHref(scope, inquiry.id, query);
              return (
                <li
                  key={inquiry.id}
                  aria-current={selected ? "true" : undefined}
                  aria-busy={pending ? "true" : undefined}
                  className={`flex gap-2 px-4 py-3 border-b border-line transition-colors border-l-2 ${
                    selected || inquiry.status === "new" ? "border-l-accent" : "border-l-transparent"
                  } ${selected || checked.has(inquiry.id) ? "bg-accent/5" : "hover:bg-ground/60"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(inquiry.id)}
                    onChange={() => toggleOne(inquiry.id)}
                    aria-label={`${inquiry.title} 선택`}
                    className="accent-accent mt-0.5 shrink-0"
                  />
                  {/* 행 본문은 진짜 링크다. 키보드 초점·Cmd+클릭 새 탭·가운데 클릭이 그대로 된다. */}
                  <Link
                    href={href}
                    onClick={() => markPending(inquiry.id)}
                    onPointerEnter={() => router.prefetch(href)}
                    className={`flex flex-col gap-1 min-w-0 flex-1 -m-1 p-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                      pending ? "cursor-progress" : ""
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
                      <span>{inquiry.inquiryNo ?? "—"}</span>
                      <span className={stale ? "text-accent font-semibold" : ""}>{elapsed}</span>
                    </span>
                    <span className="block text-sm font-semibold text-ink truncate">{inquiry.title}</span>
                    <span className="block text-xs text-muted truncate">{firstLine(inquiry.content)}</span>
                    <span className="flex items-center gap-1.5 mt-0.5 text-xs">
                      <StatusBadge status={inquiry.status} />
                      {inquiry.unreadReplyAt && (
                        <span className="inline-flex items-center h-[18px] px-1.5 rounded-full bg-accent/10 text-accent text-[11px] font-semibold whitespace-nowrap shrink-0">
                          회신 옴
                        </span>
                      )}
                      <span className="text-muted truncate">{labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey}</span>
                      {priority && <span className={`ml-auto ${priority.className}`}>{priority.label}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-t border-line bg-accent/5 text-xs shrink-0">
          <span className="font-medium tabular-nums">선택 {checked.size}건</span>
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as InquiryStatus)} className={SELECT} aria-label="일괄 변경 상태">
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={applyBulkStatus}
            disabled={bulkBusy}
            className="bg-accent text-white rounded-lg px-3 py-1 hover:bg-accent/90 disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {bulkBusy ? "변경 중…" : "상태 변경"}
          </button>
          <StatusMessage tone={bulkFailed ? "error" : "muted"}>{bulkMessage}</StatusMessage>
        </div>
      )}
      {checked.size === 0 && (
        <StatusMessage tone={bulkFailed ? "error" : "muted"} className={bulkMessage ? "px-4 py-2 border-t border-line text-xs shrink-0" : ""}>
          {bulkMessage}
        </StatusMessage>
      )}

      <footer className="flex items-center justify-between gap-2 h-11 px-4 border-t border-line text-xs text-muted shrink-0" aria-label="페이지">
        <span className="tabular-nums">
          {firstIndex}–{lastIndex} / {total}건
        </span>
        {total > pageSize && (
          <nav className="flex items-center gap-1.5" aria-label="페이지 이동">
            {query.page > 1 ? (
              <Link href={pageHref(query.page - 1)} rel="prev" className={`${PAGE_BTN} hover:bg-ground`}>
                이전
              </Link>
            ) : (
              <span aria-disabled="true" className={`${PAGE_BTN} opacity-40`}>
                이전
              </span>
            )}
            <span className="font-mono">
              {query.page} / {totalPages}
            </span>
            {query.page < totalPages ? (
              <Link href={pageHref(query.page + 1)} rel="next" className={`${PAGE_BTN} hover:bg-ground`}>
                다음
              </Link>
            ) : (
              <span aria-disabled="true" className={`${PAGE_BTN} opacity-40`}>
                다음
              </span>
            )}
          </nav>
        )}
      </footer>
    </section>
  );
}
