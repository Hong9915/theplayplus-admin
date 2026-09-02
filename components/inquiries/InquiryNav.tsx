import Link from "next/link";
import { inquiryDetailHref, inquiryListHref, type InquiryListQuery } from "@/lib/inquiry-filters";

/**
 * 목록으로 돌아가는 링크와, 같은 목록 안에서의 이전/다음 이동.
 * ids는 목록과 같은 조건·정렬로 뽑은 전체 id 목록이다.
 */
export default function InquiryNav({
  gameId,
  inquiryId,
  query,
  ids,
}: {
  gameId: string;
  inquiryId: string;
  query: InquiryListQuery;
  ids: string[];
}) {
  const index = ids.indexOf(inquiryId);
  const prevId = index > 0 ? ids[index - 1] : null;
  const nextId = index >= 0 && index < ids.length - 1 ? ids[index + 1] : null;

  const navLink = "border border-line rounded-lg px-2.5 py-1 hover:bg-ground transition-colors";
  const navDisabled = "border border-line rounded-lg px-2.5 py-1 opacity-40 cursor-default";

  return (
    <nav className="flex items-center justify-between gap-3 text-sm" aria-label="문의 이동">
      <Link href={inquiryListHref(gameId, query)} className="text-muted hover:text-ink transition-colors">
        ← 목록
      </Link>
      {index >= 0 && ids.length > 1 && (
        <div className="flex items-center gap-2">
          {prevId ? (
            <Link href={inquiryDetailHref(prevId, query)} className={navLink} rel="prev">
              ← 이전
            </Link>
          ) : (
            <span className={navDisabled} aria-disabled="true">
              ← 이전
            </span>
          )}
          <span className="font-mono text-xs text-muted">
            {index + 1} / {ids.length}
          </span>
          {nextId ? (
            <Link href={inquiryDetailHref(nextId, query)} className={navLink} rel="next">
              다음 →
            </Link>
          ) : (
            <span className={navDisabled} aria-disabled="true">
              다음 →
            </span>
          )}
        </div>
      )}
    </nav>
  );
}
