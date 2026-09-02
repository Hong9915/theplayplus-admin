"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { InquiryPage, InquiryRow, InquiryStatus } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import {
  SORT_OPTIONS,
  inquiryDetailHref,
  toInquiryListSearch,
  type InquiryListQuery,
} from "@/lib/inquiry-filters";
import StatusBadge from "@/components/ui/StatusBadge";
import { formatElapsed, formatReceivedAt } from "@/lib/format";

const STATUS_OPTIONS: Array<{ value: InquiryStatus; label: string }> = [
  { value: "new", label: "접수" },
  { value: "in_progress", label: "처리중" },
  { value: "resolved", label: "완료" },
];

const PRIORITY_LABEL: Record<InquiryRow["priority"], string> = {
  urgent: "긴급",
  high: "높음",
  normal: "보통",
  low: "낮음",
};

const PRIORITY_STYLE: Record<InquiryRow["priority"], string> = {
  urgent: "text-red-600 font-semibold",
  high: "text-amber-600 font-medium",
  normal: "text-muted",
  low: "text-muted/70",
};

const SEARCH_DEBOUNCE_MS = 300;

export default function InquiryMailbox({
  page,
  query,
  labels,
}: {
  page: InquiryPage;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(query.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<InquiryStatus>("resolved");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { rows, total, pageSize } = page;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstIndex = total === 0 ? 0 : (query.page - 1) * pageSize + 1;
  const lastIndex = Math.min(total, query.page * pageSize);

  // 서버가 준 목록이 바뀌면 선택은 의미를 잃는다.
  useEffect(() => {
    setSelected(new Set());
  }, [rows]);

  // URL이 바뀌어 다른 검색어로 렌더되면 입력창도 맞춘다 (뒤로 가기 등).
  useEffect(() => {
    setSearch(query.q);
  }, [query.q]);

  function navigate(next: Partial<InquiryListQuery>, resetPage = true) {
    const merged: InquiryListQuery = { ...query, ...next, page: resetPage ? 1 : next.page ?? query.page };
    const searchString = toInquiryListSearch(merged);
    router.replace(searchString ? `${pathname}?${searchString}` : pathname);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => navigate({ q: value.trim() }), SEARCH_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const allOnPageSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  function toggleAll() {
    setSelected(allOnPageSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkStatus() {
    if (selected.size === 0) return;
    setBulkBusy(true);
    setBulkMessage(null);

    let json: { success: boolean; updated?: number };
    try {
      const response = await fetch("/api/inquiries/bulk-status", {
        method: "POST",
        body: JSON.stringify({ ids: Array.from(selected), status: bulkStatus }),
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
    setSelected(new Set());
    router.refresh();
  }

  const detailHref = useMemo(() => (id: string) => inquiryDetailHref(id, query), [query]);

  const selectClass =
    "bg-panel border border-line rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors";

  return (
    <div className="bg-panel border border-line rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
        <select
          value={query.group ?? "all"}
          onChange={(e) => navigate({ group: e.target.value === "all" ? null : e.target.value })}
          className={selectClass}
          aria-label="종류 필터"
        >
          <option value="all">전체 종류</option>
          {Object.entries(labels.groupLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={query.type ?? "all"}
          onChange={(e) => navigate({ type: e.target.value === "all" ? null : e.target.value })}
          className={selectClass}
          aria-label="유형 필터"
        >
          <option value="all">전체 유형</option>
          {Object.entries(labels.typeLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={query.status ?? "all"}
          onChange={(e) => navigate({ status: e.target.value === "all" ? null : (e.target.value as InquiryStatus) })}
          className={selectClass}
          aria-label="상태 필터"
        >
          <option value="all">전체 상태</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={query.sort}
          onChange={(e) => navigate({ sort: e.target.value as InquiryListQuery["sort"] })}
          className={selectClass}
          aria-label="정렬"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="제목 · 접수번호 · 계정 · 본문 검색"
          className={`${selectClass} w-60`}
          aria-label="검색"
        />
        <span className="ml-auto text-sm text-muted">{total}건</span>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-line bg-accent/5 text-sm">
          <span className="font-medium">선택 {selected.size}건</span>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as InquiryStatus)}
            className={selectClass}
            aria-label="일괄 변경 상태"
          >
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
            className="bg-accent text-white rounded-lg px-3 py-1.5 text-sm hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {bulkBusy ? "변경 중…" : "상태 변경"}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-muted hover:text-ink transition-colors"
          >
            선택 해제
          </button>
          {bulkMessage && <span className="text-muted">{bulkMessage}</span>}
        </div>
      )}
      {selected.size === 0 && bulkMessage && (
        <p className="px-4 py-2 border-b border-line text-sm text-muted">{bulkMessage}</p>
      )}

      {rows.length === 0 ? (
        <p className="text-muted text-sm p-10 text-center">
          {total === 0 && !query.q && !query.group && !query.type && !query.status
            ? "접수된 문의가 없습니다."
            : "조건에 맞는 문의가 없습니다."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line bg-ground/60">
                <th className="pl-4 pr-1 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    aria-label="이 페이지 전체 선택"
                    className="accent-accent"
                  />
                </th>
                <th className="px-3 py-2.5 font-medium">접수번호</th>
                <th className="px-3 py-2.5 font-medium">종류</th>
                <th className="px-3 py-2.5 font-medium">유형</th>
                <th className="px-3 py-2.5 font-medium w-full">제목</th>
                <th className="px-3 py-2.5 font-medium">게임 계정</th>
                <th className="px-3 py-2.5 font-medium">우선순위</th>
                <th className="px-3 py-2.5 font-medium">상태</th>
                <th className="px-3 py-2.5 font-medium text-right">경과</th>
                <th className="px-4 py-2.5 font-medium">접수</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inquiry) => {
                const elapsed = formatElapsed(inquiry.createdAt);
                const stale = inquiry.status !== "resolved" && elapsed.endsWith("일");
                const href = detailHref(inquiry.id);
                return (
                  <tr
                    key={inquiry.id}
                    onClick={() => router.push(href)}
                    className={`border-b border-line last:border-b-0 cursor-pointer hover:bg-ground/60 transition-colors ${
                      inquiry.status === "new" ? "border-l-2 border-l-accent" : "border-l-2 border-l-transparent"
                    } ${selected.has(inquiry.id) ? "bg-accent/5" : ""}`}
                  >
                    <td className="pl-4 pr-1 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(inquiry.id)}
                        onChange={() => toggleOne(inquiry.id)}
                        aria-label={`${inquiry.title} 선택`}
                        className="accent-accent"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted">{inquiry.inquiryNo ?? "—"}</td>
                    <td className="px-3 py-2.5 text-muted">{labels.groupLabels[inquiry.groupKey] ?? inquiry.groupKey}</td>
                    <td className="px-3 py-2.5 text-muted">{labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey}</td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={href}
                        onClick={(e) => e.stopPropagation()}
                        className="text-ink font-medium hover:text-accent transition-colors"
                      >
                        {inquiry.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted">{inquiry.gameAccount ?? "—"}</td>
                    <td className={`px-3 py-2.5 text-xs ${PRIORITY_STYLE[inquiry.priority]}`}>
                      {PRIORITY_LABEL[inquiry.priority]}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={inquiry.status} />
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono text-xs ${
                        stale ? "text-accent font-semibold" : "text-muted"
                      }`}
                    >
                      {elapsed}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted">{formatReceivedAt(inquiry.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > pageSize && (
        <nav className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-line text-sm" aria-label="페이지">
          <span className="text-muted">
            {firstIndex}–{lastIndex} / {total}건
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate({ page: query.page - 1 }, false)}
              disabled={query.page <= 1}
              className="border border-line rounded-lg px-3 py-1 hover:bg-ground disabled:opacity-40 transition-colors"
            >
              이전
            </button>
            <span className="text-muted font-mono text-xs">
              {query.page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => navigate({ page: query.page + 1 }, false)}
              disabled={query.page >= totalPages}
              className="border border-line rounded-lg px-3 py-1 hover:bg-ground disabled:opacity-40 transition-colors"
            >
              다음
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
