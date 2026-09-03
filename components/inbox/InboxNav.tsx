import Link from "next/link";
import type { GameRow, CategoryLabelMaps } from "@/lib/categories";
import type { InquiryFacetCounts, InquiryPriority, InquiryStatus } from "@/lib/inquiries";
import { inboxHref, type InquiryListQuery } from "@/lib/inquiry-filters";
import InboxSearch from "@/components/inbox/InboxSearch";
import DeleteGameButton from "@/components/games/DeleteGameButton";

type ViewKey = InquiryStatus | "all" | "stale";

const VIEWS: Array<{ key: ViewKey; label: string; patch: Partial<InquiryListQuery> }> = [
  { key: "new", label: "접수", patch: { status: "new", stale: false } },
  { key: "in_progress", label: "처리중", patch: { status: "in_progress", stale: false } },
  { key: "resolved", label: "완료", patch: { status: "resolved", stale: false } },
  { key: "all", label: "전체", patch: { status: null, stale: false, priority: null, type: null, group: null } },
  { key: "stale", label: "3일 이상 미처리", patch: { status: null, stale: true } },
];

const PRIORITY_VIEWS: Array<{ key: InquiryPriority; label: string; dot: string }> = [
  { key: "urgent", label: "긴급", dot: "bg-red-600" },
  { key: "high", label: "높음", dot: "bg-amber-600" },
];

function isViewActive(key: ViewKey, query: InquiryListQuery): boolean {
  if (key === "stale") return query.stale;
  if (key === "all") return !query.status && !query.stale && !query.priority && !query.type;
  return query.status === key && !query.stale;
}

const ITEM = "flex items-center justify-between gap-2 h-[34px] px-2.5 rounded-lg text-[13px] transition-colors";
const ITEM_IDLE = "text-muted hover:bg-ground hover:text-ink";
const ITEM_ACTIVE = "bg-ground text-ink font-semibold";

/** 문의함 보기 열. 각 항목은 현재 쿼리에서 해당 필터만 바꾼 링크다. 건수는 부가 정보라 없어도 그린다. */
export default function InboxNav({
  game,
  query,
  labels,
  counts,
  selectedId,
}: {
  game: GameRow;
  query: InquiryListQuery;
  labels: CategoryLabelMaps;
  counts: InquiryFacetCounts | null;
  selectedId: string | null;
}) {
  const href = (patch: Partial<InquiryListQuery>) => inboxHref(game.id, selectedId, { ...query, ...patch, page: 1 });

  return (
    <aside className="w-[224px] shrink-0 h-full bg-panel border-r border-line flex flex-col gap-4 px-3 py-4 overflow-y-auto" aria-label="문의함 보기">
      <div className="flex flex-col gap-1.5 px-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-bold truncate">{game.name}</h1>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${
              game.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-ground text-muted"
            }`}
          >
            {game.status === "active" ? "서비스중" : "종료"}
          </span>
        </div>
        <p className="text-xs text-muted">{counts ? `문의함 · 전체 ${counts.total}건` : "문의함"}</p>
      </div>

      <InboxSearch gameId={game.id} query={query} selectedId={selectedId} />

      <ul className="flex flex-col gap-0.5" aria-label="보기">
        {VIEWS.map((view) => {
          const active = isViewActive(view.key, query);
          let count: number | null = null;
          if (counts) {
            count = view.key === "all" ? counts.total : view.key === "stale" ? counts.stale : counts.status[view.key];
          }
          return (
            <li key={view.key}>
              <Link href={href(view.patch)} aria-current={active ? "true" : undefined} className={`${ITEM} ${active ? ITEM_ACTIVE : ITEM_IDLE}`}>
                <span>{view.label}</span>
                {count !== null && view.key === "new" && count > 0 && (
                  <span className="inline-flex min-w-[20px] h-[18px] px-1.5 rounded-full bg-accent/10 text-accent text-[11px] font-semibold leading-[18px] justify-center">
                    {count}
                  </span>
                )}
                {count !== null && view.key !== "new" && (
                  <span className={`text-xs font-normal ${view.key === "stale" && count > 0 ? "text-accent font-semibold" : "text-muted"}`}>
                    {count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-0.5">
        <h2 className="px-2.5 pb-1.5 text-[11px] font-semibold text-muted tracking-wide">유형</h2>
        <ul className="flex flex-col gap-0.5" aria-label="유형">
          {labels.typeOrder.map((key) => {
            const active = query.type === key;
            return (
              <li key={key}>
                <Link href={href({ type: key, group: null })} aria-current={active ? "true" : undefined} className={`${ITEM} h-8 ${active ? ITEM_ACTIVE : ITEM_IDLE}`}>
                  <span className="truncate">{labels.typeLabels[key] ?? key}</span>
                  {counts && <span className="text-xs font-normal text-muted">{counts.type[key] ?? 0}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-0.5">
        <h2 className="px-2.5 pb-1.5 text-[11px] font-semibold text-muted tracking-wide">우선순위</h2>
        <ul className="flex flex-col gap-0.5" aria-label="우선순위">
          {PRIORITY_VIEWS.map((item) => {
            const active = query.priority === item.key;
            return (
              <li key={item.key}>
                <Link href={href({ priority: item.key })} aria-current={active ? "true" : undefined} className={`${ITEM} h-8 ${active ? ITEM_ACTIVE : ITEM_IDLE}`}>
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${item.dot}`} aria-hidden="true" />
                    <span>{item.label}</span>
                  </span>
                  {counts && <span className="text-xs font-normal text-muted">{counts.priority[item.key]}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <Link href={`/games/${game.id}/templates`} className={`${ITEM} h-8 ${ITEM_IDLE}`}>
          답변 템플릿
        </Link>
        <div className="px-2.5">
          <DeleteGameButton gameId={game.id} gameName={game.name} inquiryCount={counts?.total ?? 0} />
        </div>
      </div>
    </aside>
  );
}
