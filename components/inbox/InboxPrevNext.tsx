import Link from "next/link";
import { inquiryHref, type InquiryListQuery } from "@/lib/inquiry-filters";
import type { InboxScope } from "@/lib/inbox-scope";

const BTN = "w-7 h-[26px] inline-flex items-center justify-center rounded-md text-muted hover:bg-ground hover:text-ink transition-colors";
const BTN_OFF = "w-7 h-[26px] inline-flex items-center justify-center rounded-md text-muted opacity-40";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

/** 같은 목록 조건 안에서 이전/다음 문의. ids는 listInquiryIds가 같은 조건·정렬로 뽑은 전체 id다. */
export default function InboxPrevNext({
  scope,
  inquiryId,
  query,
  ids,
}: {
  scope: InboxScope;
  inquiryId: string;
  query: InquiryListQuery;
  ids: string[];
}) {
  const index = ids.indexOf(inquiryId);
  if (index < 0 || ids.length < 2) return null;

  const prevId = index > 0 ? ids[index - 1] : null;
  const nextId = index < ids.length - 1 ? ids[index + 1] : null;

  return (
    <nav className="flex items-center gap-0.5 border border-line rounded-lg p-0.5" aria-label="문의 이동">
      {prevId ? (
        <Link href={inquiryHref(scope, prevId, query)} className={BTN} aria-label="이전 문의" rel="prev">
          <Chevron dir="left" />
        </Link>
      ) : (
        <span className={BTN_OFF} aria-disabled="true">
          <Chevron dir="left" />
        </span>
      )}
      <span className="font-mono text-[11px] text-muted px-1">
        {index + 1} / {ids.length}
      </span>
      {nextId ? (
        <Link href={inquiryHref(scope, nextId, query)} className={BTN} aria-label="다음 문의" rel="next">
          <Chevron dir="right" />
        </Link>
      ) : (
        <span className={BTN_OFF} aria-disabled="true">
          <Chevron dir="right" />
        </span>
      )}
    </nav>
  );
}
