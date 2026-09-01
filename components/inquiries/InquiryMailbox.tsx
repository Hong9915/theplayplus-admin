"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InquiryRow, InquiryStatus } from "@/lib/inquiries";
import type { CategoryLabelMaps } from "@/lib/categories";
import StatusBadge from "@/components/ui/StatusBadge";

const STATUS_OPTIONS: Array<{ value: InquiryStatus; label: string }> = [
  { value: "new", label: "접수" },
  { value: "in_progress", label: "처리중" },
  { value: "resolved", label: "완료" },
];

function formatReceivedAt(iso: string): string {
  const date = new Date(iso);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hours = date.getHours();
  const meridiem = hours < 12 ? "오전" : "오후";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}. ${mm}. ${dd}. ${meridiem} ${hour12}:${min}`;
}

function elapsedDays(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export default function InquiryMailbox({
  inquiries,
  labels,
}: {
  inquiries: InquiryRow[];
  labels: CategoryLabelMaps;
}) {
  const router = useRouter();
  const [groupFilter, setGroupFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return inquiries.filter((inquiry) => {
      if (groupFilter !== "all" && inquiry.groupKey !== groupFilter) return false;
      if (typeFilter !== "all" && inquiry.typeKey !== typeFilter) return false;
      if (statusFilter !== "all" && inquiry.status !== statusFilter) return false;
      if (keyword && !inquiry.title.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [inquiries, groupFilter, typeFilter, statusFilter, search]);

  const selectClass =
    "bg-panel border border-line rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors";

  return (
    <div className="bg-panel border border-line rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
        <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className={selectClass} aria-label="종류 필터">
          <option value="all">전체 종류</option>
          {Object.entries(labels.groupLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={selectClass} aria-label="유형 필터">
          <option value="all">전체 유형</option>
          {Object.entries(labels.typeLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectClass} aria-label="상태 필터">
          <option value="all">전체 상태</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="제목 검색"
          className={`${selectClass} w-44`}
          aria-label="제목 검색"
        />
        <span className="ml-auto text-sm text-muted">{filtered.length}건</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted text-sm p-10 text-center">
          {inquiries.length === 0 ? "접수된 문의가 없습니다." : "조건에 맞는 문의가 없습니다."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line bg-ground/60">
                <th className="px-4 py-2.5 font-medium">접수번호</th>
                <th className="px-4 py-2.5 font-medium">종류</th>
                <th className="px-4 py-2.5 font-medium">유형</th>
                <th className="px-4 py-2.5 font-medium w-full">제목</th>
                <th className="px-4 py-2.5 font-medium">게임 계정</th>
                <th className="px-4 py-2.5 font-medium">상태</th>
                <th className="px-4 py-2.5 font-medium text-right">경과</th>
                <th className="px-4 py-2.5 font-medium">접수</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inquiry) => {
                const days = elapsedDays(inquiry.createdAt);
                return (
                  <tr
                    key={inquiry.id}
                    onClick={() => router.push(`/inquiries/${inquiry.id}`)}
                    className={`border-b border-line last:border-b-0 cursor-pointer hover:bg-ground/60 transition-colors ${
                      inquiry.status === "new" ? "border-l-2 border-l-accent" : "border-l-2 border-l-transparent"
                    }`}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-muted uppercase">{inquiry.id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-muted">{labels.groupLabels[inquiry.groupKey] ?? inquiry.groupKey}</td>
                    <td className="px-4 py-2.5 text-muted">{labels.typeLabels[inquiry.typeKey] ?? inquiry.typeKey}</td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/inquiries/${inquiry.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-ink font-medium hover:text-accent transition-colors"
                      >
                        {inquiry.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted">{inquiry.gameAccount ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={inquiry.status} />
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono text-xs ${
                        inquiry.status !== "resolved" && days >= 3 ? "text-accent font-semibold" : "text-muted"
                      }`}
                    >
                      {days}일
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted">{formatReceivedAt(inquiry.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
