"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inboxHref, type InquiryListQuery } from "@/lib/inquiry-filters";

const SEARCH_DEBOUNCE_MS = 300;

/** 문의함 보기 열의 검색창. 입력을 300ms 모았다가 URL의 q로 옮기고 1페이지로 돌아간다. */
export default function InboxSearch({
  gameId,
  query,
  selectedId,
}: {
  gameId: string;
  query: InquiryListQuery;
  selectedId: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 뒤로 가기 등으로 URL의 q가 바뀌면 입력창도 맞춘다.
  useEffect(() => {
    setValue(query.q);
  }, [query.q]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function handleChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      router.replace(inboxHref(gameId, selectedId, { ...query, q: next.trim(), page: 1 }));
    }, SEARCH_DEBOUNCE_MS);
  }

  return (
    <label className="flex items-center gap-2 h-[34px] px-2.5 border border-line rounded-lg bg-ground text-muted focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40 transition-colors">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <line x1="20" y1="20" x2="16.5" y2="16.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="제목·접수번호·계정·본문 검색"
        aria-label="검색"
        className="flex-1 min-w-0 bg-transparent text-[13px] text-ink placeholder:text-muted focus:outline-none"
      />
    </label>
  );
}
