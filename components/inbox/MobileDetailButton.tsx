"use client";

/** 모바일에서 상세 패널을 여는 window 이벤트. InboxDetailPanel이 듣는다. */
export const OPEN_DETAIL_EVENT = "inbox:open-detail";

/**
 * 모바일 대화 헤더의 "정보" 버튼. 화면이 좁으면 상세 패널이 숨으므로 이걸로 덮개처럼 연다.
 * 데스크톱(md 이상)에서는 상세 패널이 늘 옆에 있어 보이지 않는다.
 */
export default function MobileDetailButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_DETAIL_EVENT))}
      className="md:hidden h-9 px-3 inline-flex items-center gap-1.5 rounded-[9px] text-[13.5px] font-semibold text-ink-2 hover:bg-line-soft active:bg-line transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
      정보
    </button>
  );
}
