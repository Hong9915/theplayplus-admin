"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { GameRow } from "@/lib/categories";
import Dialog from "@/components/ui/Dialog";
import SettingsIcon from "@/components/ui/SettingsIcon";
import LoungeConnectDialog from "@/components/inbox/LoungeConnectDialog";
import DeleteGameButton from "@/components/games/DeleteGameButton";

type Phase = "closed" | "open" | "closing";

const ROW = "flex items-center gap-3.5 p-2.5 rounded-xl text-left hover:bg-well active:bg-line-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

function SettingsLink({ href, title, hint, icon }: { href: string; title: string; hint: string; icon: ReactNode }) {
  return (
    <Link href={href} className={ROW}>
      <SettingsIcon>{icon}</SettingsIcon>
      <span className="flex flex-col min-w-0">
        <span className="font-semibold text-ink">{title}</span>
        <span className="text-[13px] text-muted">{hint}</span>
      </span>
    </Link>
  );
}

/**
 * 매일 쓰지는 않는 게임 설정(템플릿·웹사이트 페이지·라운지 연결)과 되돌릴 수 없는 삭제를
 * 문의함 화면에서 한 단계 안으로 넣는다. 오른쪽에서 들어와 같은 길로 나간다.
 */
export default function GameSettingsDrawer({ game, inquiryCount }: { game: GameRow; inquiryCount: number }) {
  const [phase, setPhase] = useState<Phase>("closed");

  // 나가는 애니메이션이 끝나면 내린다. animationend가 오지 않는 환경(테스트 등)을 위해 시간으로도 끝낸다.
  useEffect(() => {
    if (phase !== "closing") return;
    const timer = setTimeout(() => setPhase("closed"), 240);
    return () => clearTimeout(timer);
  }, [phase]);

  return (
    <>
      <button
        type="button"
        onClick={() => setPhase("open")}
        aria-haspopup="dialog"
        className="flex items-center gap-1.5 h-[34px] px-2.5 rounded-[9px] text-[13.5px] font-medium text-ink-2 hover:bg-line-soft hover:text-ink active:bg-line transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
        </svg>
        게임 설정
      </button>

      {phase !== "closed" && (
        <Dialog
          labelledBy="game-settings-title"
          placement="right"
          onClose={() => setPhase("closing")}
          onAnimationEnd={() => {
            if (phase === "closing") setPhase("closed");
          }}
          backdropClassName={phase === "closing" ? "animate-fade-out" : "animate-fade-in"}
          className={`max-w-[440px] flex flex-col ${phase === "closing" ? "animate-drawer-out" : "animate-drawer-in"}`}
        >
          <header className="flex items-center gap-2.5 px-6 py-5 border-b border-line-soft">
            <h2 id="game-settings-title" className="text-lg font-bold tracking-[-.02em] truncate">
              {game.name} 설정
            </h2>
            <button
              type="button"
              onClick={() => setPhase("closing")}
              aria-label="닫기"
              className="ml-auto w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-ink-2 hover:bg-well hover:text-ink transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          <div className="flex-1 flex flex-col gap-1 px-3.5 py-3">
            <SettingsLink
              href={`/games/${game.id}/templates`}
              title="답변 템플릿"
              hint="접수 안내 자동 발송과 답변 본보기"
              icon={<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />}
            />
            <SettingsLink
              href={`/games/${game.id}/site`}
              title="웹사이트 게임 페이지"
              hint="소개, 출시일, 사전예약 기간, 이미지"
              icon={
                <>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                </>
              }
            />
            <LoungeConnectDialog gameId={game.id} loungeId={game.naverLoungeId ?? null} asRow />

            {/* 되돌릴 수 없는 동작은 매일 쓰는 것들과 떨어진 경고 구역에만 둔다. */}
            <section className="mt-6 mx-2.5 p-4 rounded-xl ring-1 ring-inset ring-heat-hot/35" aria-labelledby="game-danger-title">
              <h3 id="game-danger-title" className="font-semibold text-heat-hot">
                게임 삭제
              </h3>
              <p className="mt-1 mb-3 text-[13px] text-ink-2">
                문의와 첨부파일이 모두 지워지며 되돌릴 수 없습니다. 서비스를 끝냈다면 삭제 대신 게임 상태를 &lsquo;종료&rsquo;로 두세요.
              </p>
              <DeleteGameButton gameId={game.id} gameName={game.name} inquiryCount={inquiryCount} />
            </section>
          </div>
        </Dialog>
      )}
    </>
  );
}
