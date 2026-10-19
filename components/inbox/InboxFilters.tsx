"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CategoryLabelMaps } from "@/lib/categories";
import type { InquiryFacetCounts, InquiryPriority, InquiryStatus } from "@/lib/inquiries";
import { SORT_OPTIONS, inboxHref, type InquiryListQuery } from "@/lib/inquiry-filters";
import type { InboxScope } from "@/lib/inbox-scope";

type ViewKey = InquiryStatus | "all" | "stale" | "unread";

/** 하루에 가장 자주 여는 순서로: 새로 온 것 → 하던 것 → 사용자가 답한 것 → 밀린 것 → 끝난 것. */
const VIEWS: Array<{ key: ViewKey; label: string; patch: Partial<InquiryListQuery> }> = [
  { key: "new", label: "접수", patch: { status: "new", stale: false, unread: false } },
  { key: "in_progress", label: "처리중", patch: { status: "in_progress", stale: false, unread: false } },
  // 자동 동기화가 가져온 사용자 회신을 아직 열어 보지 않은 건.
  { key: "unread", label: "회신 도착", patch: { status: null, stale: false, unread: true } },
  { key: "stale", label: "3일 이상 미처리", patch: { status: null, stale: true, unread: false } },
  { key: "resolved", label: "완료", patch: { status: "resolved", stale: false, unread: false } },
  { key: "all", label: "전체", patch: { status: null, stale: false, unread: false, priority: null, type: null, group: null } },
];

const PRIORITY_OPTIONS: Array<{ value: InquiryPriority; label: string }> = [
  { value: "urgent", label: "긴급" },
  { value: "high", label: "높음" },
];

function isViewActive(key: ViewKey, query: InquiryListQuery): boolean {
  if (key === "stale") return query.stale;
  if (key === "unread") return query.unread;
  if (key === "all") return !query.status && !query.stale && !query.unread && !query.priority && !query.type;
  return query.status === key && !query.stale && !query.unread;
}

function viewCount(key: ViewKey, counts: InquiryFacetCounts): number {
  switch (key) {
    case "all":
      return counts.total;
    case "stale":
      return counts.stale;
    case "unread":
      return counts.unread;
    default:
      return counts.status[key];
  }
}

const CHIP = "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[9px] text-[13.5px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const SELECT =
  "appearance-none h-[30px] pl-2.5 pr-7 rounded-lg bg-panel ring-1 ring-inset ring-line text-[13px] text-ink-2 select-chevron focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

/**
 * 목록 머리의 보기·필터·정렬. 보기는 링크(Cmd+클릭, 새로 고침에도 그대로), 유형·우선순위·정렬은 고르는 즉시 URL을 바꾼다.
 * 어느 쪽이든 1페이지로 돌아가고 열어 둔 문의는 유지한다.
 */
export default function InboxFilters({
  scope,
  query,
  labels,
  counts,
  selectedId,
}: {
  scope: InboxScope;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  counts: InquiryFacetCounts | null;
  selectedId: string | null;
}) {
  const router = useRouter();
  const href = (patch: Partial<InquiryListQuery>) => inboxHref(scope, selectedId, { ...query, ...patch, page: 1 });
  const navigate = (patch: Partial<InquiryListQuery>) => router.replace(href(patch));

  return (
    <div className="flex flex-col gap-2.5 px-3.5 pt-3.5 pb-2.5 border-b border-line-soft">
      <ul className="flex flex-wrap gap-1" aria-label="보기">
        {VIEWS.map((view) => {
          const active = isViewActive(view.key, query);
          const count = counts ? viewCount(view.key, counts) : null;
          const isNew = view.key === "new";
          // 밀린 일과 사용자 회신은 0이 아닐 때만 눈에 띄게.
          const alarming = (view.key === "stale" || view.key === "unread") && count !== null && count > 0;
          const tone = active
            ? isNew
              ? "bg-accent text-white"
              : "bg-ink text-white"
            : "text-ink-2 hover:bg-line-soft active:bg-line";
          const countTone = active ? "opacity-75" : isNew && count ? "text-accent" : alarming ? "text-heat-stale" : "text-muted";
          return (
            <li key={view.key}>
              <Link href={href(view.patch)} aria-current={active ? "true" : undefined} className={`${CHIP} ${tone}`}>
                <span>{view.label}</span>
                {count !== null && <span className={`text-[12.5px] tabular-nums ${countTone}`}>{count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-1.5">
        <select
          value={query.type ?? ""}
          onChange={(e) => navigate({ type: e.target.value || null, group: null })}
          aria-label="유형"
          className={`${SELECT} min-w-0 flex-1 max-w-[150px]`}
        >
          <option value="">모든 유형</option>
          {labels.typeOrder.map((key) => (
            <option key={key} value={key}>
              {labels.typeLabels[key] ?? key}
              {counts ? ` (${counts.type[key] ?? 0})` : ""}
            </option>
          ))}
        </select>
        <select
          value={query.priority ?? ""}
          onChange={(e) => navigate({ priority: (e.target.value || null) as InquiryPriority | null })}
          aria-label="우선순위"
          className={SELECT}
        >
          <option value="">모든 우선순위</option>
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
              {counts ? ` (${counts.priority[option.value]})` : ""}
            </option>
          ))}
        </select>
        <select
          value={query.sort}
          onChange={(e) => navigate({ sort: e.target.value as InquiryListQuery["sort"] })}
          aria-label="정렬"
          className={`${SELECT} ml-auto`}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
