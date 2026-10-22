import type { ReactNode } from "react";
import Link from "next/link";
import type { GameRow } from "@/lib/categories";
import type { InquiryFacetCounts } from "@/lib/inquiries";
import type { InquiryListQuery } from "@/lib/inquiry-filters";
import type { InboxScope } from "@/lib/inbox-scope";
import InboxSearch from "@/components/inbox/InboxSearch";
import GameSettingsDrawer from "@/components/games/GameSettingsDrawer";

const TLINK =
  "flex items-center gap-1.5 h-[34px] px-2.5 rounded-[9px] text-[13.5px] font-medium text-ink-2 whitespace-nowrap hover:bg-line-soft hover:text-ink active:bg-line transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/**
 * 문의함 상단 바. 지금 어느 게임에 있는지, 검색, 그리고 문의함 밖으로 나가는 길(라운지·게임 설정)을 둔다.
 * 보기·유형·우선순위 같은 목록 조건은 목록 머리(InboxFilters)에 있다.
 * game은 게임 스코프에서만 온다. 서비스 문의에는 상태·라운지·설정이 없다.
 */
export default function InboxTopBar({
  scope,
  title,
  game,
  query,
  counts,
  selectedId,
  loungeUnread = null,
}: {
  scope: InboxScope;
  title: string;
  game: GameRow | null;
  query: InquiryListQuery;
  counts: InquiryFacetCounts | null;
  selectedId: string | null;
  loungeUnread?: number | null;
}) {
  return (
    <header className="flex items-center gap-3.5 h-14 shrink-0 pl-5 pr-4" aria-label="문의함">
      <div className="flex items-center gap-2.5 min-w-0">
        <h1 className="text-[17px] font-bold tracking-[-.02em] truncate">{title}</h1>
        {game && (
          <span
            className={`inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md text-xs font-semibold shrink-0 ${
              game.status === "active" ? "bg-done-wash text-done" : "bg-line-soft text-muted"
            }`}
          >
            {game.status === "active" && <span className="w-1.5 h-1.5 rounded-full bg-[#2FA36B]" aria-hidden="true" />}
            {game.status === "active" ? "서비스중" : "종료"}
          </span>
        )}
        <span className="text-[13px] text-muted whitespace-nowrap tabular-nums">{counts ? `문의함 · 전체 ${counts.total}건` : "문의함"}</span>
      </div>

      <div className="ml-auto w-[320px] shrink">
        <InboxSearch scope={scope} query={query} selectedId={selectedId} />
      </div>

      {game && (
        <nav className="flex items-center gap-0.5" aria-label="게임 도구">
          {game.naverLoungeId && (
            <Link href={`/games/${game.id}/lounge`} className={TLINK}>
              <Icon>
                <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
              </Icon>
              라운지 새 글
              {loungeUnread !== null && (
                <span
                  className={`min-w-[20px] h-[18px] px-1.5 rounded-full text-[11.5px] font-bold leading-[18px] text-center tabular-nums ${
                    loungeUnread > 0 ? "bg-[#03C75A] text-white" : "bg-line-soft text-muted"
                  }`}
                >
                  {loungeUnread}
                </span>
              )}
            </Link>
          )}
          <GameSettingsDrawer game={game} inquiryCount={counts?.total ?? 0} />
        </nav>
      )}
    </header>
  );
}
