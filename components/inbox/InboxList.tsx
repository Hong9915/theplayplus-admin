"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { InquiryPage, InquiryRow, InquiryStatus } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import { SORT_OPTIONS, inboxHref, inquiryHref, type InquiryListQuery } from "@/lib/inquiry-filters";
import type { InboxScope } from "@/lib/inbox-scope";
import StatusBadge from "@/components/ui/StatusBadge";
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
  "bg-panel border border-line rounded-lg px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors";

function hasFilter(query: InquiryListQuery): boolean {
  return Boolean(query.group || query.type || query.status || query.priority || query.stale || query.q);
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
}: {
  scope: InboxScope;
  page: InquiryPage;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  selectedId: string | null;
  /** 머리에 보여줄 현재 보기 이름 (접수, 처리중, 전체 …). */
  viewLabel: string;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<InquiryStatus>("resolved");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  // 클릭한 문의를 서버 응답 전에 먼저 강조한다. 서버가 그 문의를 선택으로 돌려주면 지운다.
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { rows, total, pageSize } = page;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstIndex = total === 0 ? 0 : (query.page - 1) * pageSize + 1;
  const lastIndex = Math.min(total, query.page * pageSize);

  // 서버가 준 목록이 바뀌면 체크는 의미를 잃는다.
  useEffect(() => {
    setChecked(new Set());
  }, [rows]);

  useEffect(() => {
    setPendingId(null);
  }, [selectedId]);

  const shownId = pendingId ?? selectedId;

  function open(inquiryId: string) {
    if (inquiryId === selectedId) return;
    setPendingId(inquiryId);
    router.push(inquiryHref(scope, inquiryId, query));
  }

  function navigate(next: Partial<InquiryListQuery>, resetPage = true) {
    const merged: InquiryListQuery = { ...query, ...next, page: resetPage ? 1 : next.page ?? query.page };
    router.replace(inboxHref(scope, selectedId, merged));
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

    let json: { success: boolean; updated?: number };
    try {
      const response = await fetch("/api/inquiries/bulk-status", {
        method: "POST",
        body: JSON.stringify({ ids: Array.from(checked), status: bulkStatus }),
      });
      json = await response.json();
    } catch {
      setBulkBusy(false);
      setBulkMessage("상태 변경에 실패했습니다.");
      return;
    }
    setBulkBusy(false);

    if (!json.success) {
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
            <span>{viewLabel}</span> <span className="text-muted font-normal">{total}건</span>
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
              const elapsed = formatElapsed(inquiry.createdAt);
              const stale = inquiry.status !== "resolved" && elapsed.endsWith("일");
              const selected = inquiry.id === shownId;
              const pending = pendingId !== null && inquiry.id === pendingId;
              const priority = PRIORITY_MARK[inquiry.priority];
              return (
                <li
                  key={inquiry.id}
                  onClick={() => open(inquiry.id)}
                  onPointerEnter={() => router.prefetch(inquiryHref(scope, inquiry.id, query))}
                  aria-current={selected ? "true" : undefined}
                  aria-busy={pending ? "true" : undefined}
                  className={`flex gap-2 px-4 py-3 border-b border-line cursor-pointer transition-colors border-l-2 ${pending ? "cursor-progress" : ""} ${
                    selected || inquiry.status === "new" ? "border-l-accent" : "border-l-transparent"
                  } ${selected || checked.has(inquiry.id) ? "bg-accent/5" : "hover:bg-ground/60"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(inquiry.id)}
                    onChange={() => toggleOne(inquiry.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${inquiry.title} 선택`}
                    className="accent-accent mt-0.5"
                  />
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
                      <span>{inquiry.inquiryNo ?? "—"}</span>
                      <span className={stale ? "text-accent font-semibold" : ""}>{elapsed}</span>
                    </div>
                    <p className="text-sm font-semibold text-ink truncate">{inquiry.title}</p>
                    <p className="text-xs text-muted truncate">{firstLine(inquiry.content)}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs">
                      <StatusBadge status={inquiry.status} />
                      <span className="text-muted truncate">{labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey}</span>
                      {priority && <span className={`ml-auto ${priority.className}`}>{priority.label}</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-t border-line bg-accent/5 text-xs shrink-0">
          <span className="font-medium">선택 {checked.size}건</span>
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
            className="bg-accent text-white rounded-lg px-3 py-1 hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            상태 변경
          </button>
          {bulkMessage && <span className="text-muted">{bulkMessage}</span>}
        </div>
      )}
      {checked.size === 0 && bulkMessage && (
        <p className="px-4 py-2 border-t border-line text-xs text-muted shrink-0">{bulkMessage}</p>
      )}

      <footer className="flex items-center justify-between gap-2 h-11 px-4 border-t border-line text-xs text-muted shrink-0" aria-label="페이지">
        <span>
          {firstIndex}–{lastIndex} / {total}건
        </span>
        {total > pageSize && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate({ page: query.page - 1 }, false)}
              disabled={query.page <= 1}
              className="border border-line rounded-lg px-2 py-0.5 hover:bg-ground disabled:opacity-40 transition-colors"
            >
              이전
            </button>
            <span className="font-mono">
              {query.page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => navigate({ page: query.page + 1 }, false)}
              disabled={query.page >= totalPages}
              className="border border-line rounded-lg px-2 py-0.5 hover:bg-ground disabled:opacity-40 transition-colors"
            >
              다음
            </button>
          </div>
        )}
      </footer>
    </section>
  );
}
