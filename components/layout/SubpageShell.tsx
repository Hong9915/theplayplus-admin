import type { ReactNode } from "react";
import Link from "next/link";

/**
 * 문의함에서 들어가는 게임 하위 화면(라운지·답변 템플릿·웹사이트 게임 페이지)의 틀.
 * 문의함 상단 바와 같은 높이·글자로 "어디에 있는지(게임 › 화면)"와 "어떻게 돌아가는지(‹ 문의함)"를 알려 주고,
 * 그 아래 둥근 작업면 하나에 내용을 담는다. 작업면은 옅은 회색이고 내용 카드가 흰 면으로 올라온다.
 */
export default function SubpageShell({
  gameId,
  gameName,
  title,
  badge,
  actions,
  children,
}: {
  gameId: string;
  gameName: string;
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col h-screen flex-1 min-w-0">
      <header className="flex items-center gap-3 h-14 shrink-0 pl-3 pr-4">
        <Link
          href={`/games/${gameId}/inquiries`}
          className="flex items-center gap-0.5 h-[34px] pl-1.5 pr-2.5 rounded-[9px] text-[13.5px] font-medium text-ink-2 hover:bg-line-soft hover:text-ink active:bg-line transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 6-6 6 6 6" />
          </svg>
          문의함
        </Link>
        <span className="w-px h-5 bg-line" aria-hidden="true" />
        <div className="flex items-center gap-2 min-w-0 text-[17px] tracking-[-.02em]">
          <span className="font-semibold text-muted truncate">{gameName}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
          <h1 className="font-bold whitespace-nowrap">{title}</h1>
          {badge}
        </div>
        {actions && <div className="ml-auto flex items-center gap-1.5 shrink-0">{actions}</div>}
      </header>
      <div className="flex-1 min-h-0 mx-2.5 mb-2.5 rounded-2xl bg-well ring-1 ring-line-soft overflow-y-auto">{children}</div>
    </div>
  );
}

/** 하위 화면 상단 바의 보조 동작(외부 링크·버튼) 모양. */
export const SUBPAGE_ACTION =
  "inline-flex items-center gap-1.5 h-[34px] px-3 rounded-[9px] text-[13.5px] font-semibold text-ink-2 ring-1 ring-inset ring-line bg-panel hover:text-ink hover:bg-well active:bg-line-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
