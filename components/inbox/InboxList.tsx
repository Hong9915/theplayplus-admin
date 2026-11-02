"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InquiryFacetCounts, InquiryPage, InquiryRow, InquiryStatus } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import { inboxHref, inquiryHref, type InquiryListQuery } from "@/lib/inquiry-filters";
import type { InboxScope } from "@/lib/inbox-scope";
import StatusBadge from "@/components/ui/StatusBadge";
import InboxFilters from "@/components/inbox/InboxFilters";
import StatusMessage from "@/components/ui/StatusMessage";
import { usePersistedBoolean } from "@/components/ui/usePersistedBoolean";
import { formatElapsed } from "@/lib/format";
import { HEAT_BG, HEAT_LABELS, HEAT_TEXT, heatLevel } from "@/lib/heat";

const COLLAPSE_KEY = "inbox-list-collapsed";

const STATUS_OPTIONS: Array<{ value: InquiryStatus; label: string }> = [
  { value: "new", label: "접수" },
  { value: "in_progress", label: "처리중" },
  { value: "resolved", label: "완료" },
];

/** 보통·낮음은 소음이라 표시하지 않는다. */
const PRIORITY_MARK: Partial<Record<InquiryRow["priority"], { label: string; className: string }>> = {
  urgent: { label: "긴급", className: "bg-heat-hot text-white" },
  high: { label: "높음", className: "ring-[1.5px] ring-inset ring-heat-hot text-heat-hot" },
};

const SELECT =
  "appearance-none h-7 pl-2.5 pr-7 rounded-[7px] bg-white/10 text-[13px] text-white select-chevron focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

const ICON_BTN =
  "w-[30px] h-[30px] flex items-center justify-center rounded-lg text-ink-2 hover:bg-line-soft hover:text-ink active:bg-line transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const PAGE_BTN = "h-7 px-2.5 inline-flex items-center rounded-lg transition-colors";

function PanelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

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
  counts = null,
  selectedId,
  viewLabel,
  now = Date.now(),
}: {
  scope: InboxScope;
  page: InquiryPage;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  /** 보기·유형·우선순위 옆 건수. 없으면 숫자 없이 그린다. */
  counts?: InquiryFacetCounts | null;
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
  const [collapsed, setCollapsed] = usePersistedBoolean(COLLAPSE_KEY, false);
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

  async function downloadDevReport() {
    if (checked.size === 0) return;
    setBulkBusy(true);
    setBulkMessage(null);
    setBulkFailed(false);
    try {
      const response = await fetch("/api/inquiries/dev-report", {
        method: "POST",
        body: JSON.stringify({ ids: Array.from(checked) }),
      });
      if (!response.ok) throw new Error("export_failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `개발사전달_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      setBulkMessage(`${checked.size}건을 엑셀로 내려받았습니다.`);
    } catch {
      setBulkFailed(true);
      setBulkMessage("엑셀 만들기에 실패했습니다.");
    }
    setBulkBusy(false);
  }

  // 모바일은 목록과 대화를 한 화면씩 보여 준다: 문의를 고르면 목록을 숨긴다.
  // 접기는 데스크톱 전용이라 모바일에서는 접혀 있어도 목록을 그린다.
  const mobileClass = selectedId ? "hidden" : "flex";
  const desktopClass = collapsed ? "md:hidden" : "md:flex";

  return (
    <>
      {collapsed && (
        <section className="hidden md:flex w-12 shrink-0 h-full bg-well flex-col items-center pt-3" aria-label="문의 목록 (접힘)">
          <button type="button" onClick={() => setCollapsed(false)} aria-label="목록 펼치기" title="목록 펼치기" className={ICON_BTN}>
            <PanelIcon />
          </button>
        </section>
      )}
      <section className={`${mobileClass} ${desktopClass} w-full md:w-[376px] shrink-0 h-full bg-well flex-col overflow-hidden`} aria-label="문의 목록">
        <InboxFilters scope={scope} query={query} labels={labels} counts={counts} selectedId={selectedId} />

        <header className="flex items-center justify-between gap-2 h-11 pl-[22px] pr-2.5 shrink-0">
          <label className="flex items-center gap-2.5 min-w-0 text-[13px] font-semibold">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="이 페이지 전체 선택" className="w-4 h-4 accent-accent" />
            <span className="truncate">
              <span>{viewLabel}</span> <span className="text-muted font-normal tabular-nums">{total}건</span>
            </span>
          </label>
          <button type="button" onClick={() => setCollapsed(true)} aria-label="목록 접기" title="목록 접기" className={`${ICON_BTN} max-md:hidden`}>
            <PanelIcon />
          </button>
        </header>

        {checked.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-3.5 py-2 bg-ink text-white text-[13px] shrink-0">
            <span className="font-semibold tabular-nums">선택 {checked.size}건</span>
            <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as InquiryStatus)} className={SELECT} aria-label="일괄 변경 상태">
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="text-ink">
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={applyBulkStatus}
              disabled={bulkBusy}
              className="h-7 px-3 rounded-[7px] bg-accent font-semibold hover:brightness-105 active:brightness-95 disabled:opacity-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {bulkBusy ? "처리 중…" : "상태 변경"}
            </button>
            <button
              type="button"
              onClick={downloadDevReport}
              disabled={bulkBusy}
              title="시간·서버·캐릭터·문제·스크린샷을 개발사 양식(한·중 머리글)으로 내려받습니다"
              className="h-7 px-3 rounded-[7px] border border-white/30 font-semibold hover:bg-white/10 disabled:opacity-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              개발사 전달 엑셀
            </button>
            {/* 어두운 막대 위라 기본 글자색 대신 밝은 톤으로. */}
            <StatusMessage tone={bulkFailed ? "error" : "muted"} className={bulkFailed ? "!text-[#FF9A8A]" : "!text-white/80"}>
              {bulkMessage}
            </StatusMessage>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              {hasFilter(query) ? "조건에 맞는 문의가 없습니다." : "접수된 문의가 없습니다."}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5" aria-label="문의">
              {rows.map((inquiry) => {
                const elapsed = formatElapsed(inquiry.createdAt, reference);
                const heat = heatLevel(inquiry.createdAt, inquiry.status, reference);
                const selected = inquiry.id === shownId;
                const pending = pendingId !== null && inquiry.id === pendingId;
                const priority = PRIORITY_MARK[inquiry.priority];
                const href = inquiryHref(scope, inquiry.id, query);
                return (
                  <li
                    key={inquiry.id}
                    aria-current={selected ? "true" : undefined}
                    aria-busy={pending ? "true" : undefined}
                    data-heat={heat}
                    className={`group relative flex gap-2.5 pl-[22px] pr-3 py-[11px] rounded-xl transition-[background-color,box-shadow] ${
                      selected ? "bg-panel shadow-paper" : checked.has(inquiry.id) ? "bg-panel/70" : "hover:bg-panel/60 active:bg-panel"
                    }`}
                  >
                    {/* 경과 열 띠: 미처리 시간이 길수록 청록 → 황토 → 적색 → 자두. 완료는 회색. */}
                    <span className={`absolute left-[7px] top-3 bottom-3 w-1 rounded ${HEAT_BG[heat]}`} title={HEAT_LABELS[heat]} aria-hidden="true" />
                    <input
                      type="checkbox"
                      checked={checked.has(inquiry.id)}
                      onChange={() => toggleOne(inquiry.id)}
                      aria-label={`${inquiry.title} 선택`}
                      className={`w-4 h-4 accent-accent mt-0.5 shrink-0 transition-opacity ${
                        checked.size > 0 || checked.has(inquiry.id) ? "opacity-100" : "opacity-35 group-hover:opacity-100 focus-visible:opacity-100"
                      }`}
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
                      <span className="flex items-center justify-between gap-2 text-[12.5px] text-muted tracking-[.01em]">
                        <span className="font-semibold text-ink-2">{inquiry.inquiryNo ?? "—"}</span>
                        <span className={`font-semibold ${HEAT_TEXT[heat]}`}>{elapsed}</span>
                      </span>
                      <span className="flex items-baseline gap-1.5 min-w-0">
                        {inquiry.unreadReplyAt && <span className="w-[7px] h-[7px] rounded-full bg-accent shrink-0 -translate-y-px" aria-hidden="true" />}
                        <span className="block text-[14.5px] leading-snug font-semibold tracking-[-.01em] text-ink truncate">{inquiry.title}</span>
                      </span>
                      <span className="block text-[13px] text-muted truncate">{firstLine(inquiry.content)}</span>
                      <span className="flex flex-wrap items-center gap-1.5 mt-1">
                        <StatusBadge status={inquiry.status} />
                        {inquiry.unreadReplyAt && (
                          <span className="inline-flex items-center h-[22px] px-2 rounded-md bg-accent-wash text-accent-ink text-xs font-semibold whitespace-nowrap shrink-0">
                            회신 옴
                          </span>
                        )}
                        {priority && (
                          <span className={`inline-flex items-center h-[22px] px-2 rounded-md text-xs font-semibold whitespace-nowrap ${priority.className}`}>{priority.label}</span>
                        )}
                        <span className="inline-flex items-center h-[22px] px-2 rounded-md bg-line-soft text-ink-2 text-xs font-medium truncate max-w-[140px]">
                          {labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {checked.size === 0 && (
          <StatusMessage tone={bulkFailed ? "error" : "muted"} className={bulkMessage ? "px-4 py-2 border-t border-line-soft text-xs shrink-0" : ""}>
            {bulkMessage}
          </StatusMessage>
        )}

        <footer className="flex items-center justify-between gap-2 h-11 px-4 border-t border-line-soft text-[12.5px] text-muted shrink-0" aria-label="페이지">
          <span className="tabular-nums">
            {firstIndex}–{lastIndex} / {total}건
          </span>
          {total > pageSize && (
            <nav className="flex items-center gap-1.5" aria-label="페이지 이동">
              {query.page > 1 ? (
                <Link href={pageHref(query.page - 1)} rel="prev" className={`${PAGE_BTN} text-ink-2 hover:bg-line-soft active:bg-line`}>
                  이전
                </Link>
              ) : (
                <span aria-disabled="true" className={`${PAGE_BTN} opacity-40`}>
                  이전
                </span>
              )}
              <span className="tabular-nums">
                {query.page} / {totalPages}
              </span>
              {query.page < totalPages ? (
                <Link href={pageHref(query.page + 1)} rel="next" className={`${PAGE_BTN} text-ink-2 hover:bg-line-soft active:bg-line`}>
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
    </>
  );
}
