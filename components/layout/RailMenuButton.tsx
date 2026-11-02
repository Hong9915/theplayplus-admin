"use client";

/** 모바일에서 게임 레일 서랍을 여는 window 이벤트. GameRail이 듣는다. */
export const OPEN_RAIL_EVENT = "admin:open-rail";

/**
 * 모바일 상단 바 왼쪽의 ☰ 버튼. 화면이 좁으면 게임 레일이 숨으므로 이걸로 서랍을 연다.
 * 데스크톱(md 이상)에서는 보이지 않는다.
 */
export default function RailMenuButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_RAIL_EVENT))}
      aria-label="게임 목록 열기"
      className="md:hidden -ml-1 w-10 h-10 shrink-0 flex items-center justify-center rounded-[10px] text-ink-2 hover:bg-line-soft active:bg-line transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );
}
