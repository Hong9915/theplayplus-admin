"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import type { GameRow } from "@/lib/categories";
import { getGameLogoPublicUrl } from "@/lib/storage";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import GameForm from "@/components/games/GameForm";
import Dialog from "@/components/ui/Dialog";
import { SERVICE_RAIL_KEY, SERVICE_SCOPE_TITLE } from "@/lib/inbox-scope";

const TILE =
  "relative w-10 h-10 rounded-xl flex items-center justify-center transition-[opacity,box-shadow] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel";
const TILE_ACTIVE = "ring-2 ring-accent ring-offset-2 ring-offset-panel";
const TILE_IDLE = "opacity-70 hover:opacity-100 hover:ring-2 hover:ring-line hover:ring-offset-2 hover:ring-offset-panel";

function NewBadge({ pending }: { pending: number }) {
  if (pending <= 0) return null;
  return (
    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-semibold leading-[18px] text-center ring-2 ring-panel tabular-nums">
      {/* 눈에는 숫자만, 보조기기에는 뜻까지. span의 aria-label은 읽히지 않는 경우가 많다. */}
      <span aria-hidden="true">{pending > 99 ? "99+" : pending}</span>
      <span className="sr-only">접수 {pending}건</span>
    </span>
  );
}

/** 게임 없이 접수된 서비스 문의(제휴·기타)로 가는 고정 타일. 게임 목록 맨 위에 놓인다. */
function ServiceTile({ active, pending }: { active: boolean; pending: number }) {
  const label = `${SERVICE_SCOPE_TITLE} (제휴·기타)`;
  return (
    <Link
      href="/service/inquiries"
      title={pending > 0 ? `${label} · 접수 ${pending}건` : label}
      aria-current={active ? "page" : undefined}
      className={`${TILE} ${active ? TILE_ACTIVE : TILE_IDLE}`}
    >
      <span className="w-10 h-10 bg-ground border border-line rounded-xl flex items-center justify-center text-muted">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 6 9-6" />
        </svg>
        <span className="sr-only">{SERVICE_SCOPE_TITLE}</span>
      </span>
      <NewBadge pending={pending} />
    </Link>
  );
}

export default function GameRail({
  games,
  newCounts = {},
}: {
  games: GameRow[];
  /** 게임별 접수(new) 건수. 없으면 배지를 그리지 않는다. */
  newCounts?: Record<string, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [showAddModal, setShowAddModal] = useState(false);
  // 입력이 있는 채로 바깥을 눌렀을 때 바로 버리지 않고 한 번 묻는다.
  const [formDirty, setFormDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const handleDirtyChange = useCallback((dirty: boolean) => setFormDirty(dirty), []);

  function closeAddModal() {
    setShowAddModal(false);
    setConfirmClose(false);
    setFormDirty(false);
  }

  function requestCloseAddModal() {
    if (formDirty) {
      setConfirmClose(true);
      return;
    }
    closeAddModal();
  }

  async function handleLogout() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <aside className="w-16 shrink-0 h-screen sticky top-0 bg-panel border-r border-line flex flex-col items-center py-3 gap-2">
        <div className="w-10 h-10 rounded-xl bg-ink flex items-center justify-center select-none" title="THE PLAY+ Admin">
          <img src="/brand/theplayplus-mark-white.png" alt="THE PLAY+" width={160} height={160} className="w-7 h-7 object-contain" draggable={false} />
        </div>

        <div className="w-8 border-t border-line my-1" />

        <nav className="flex-1 w-full overflow-y-auto flex flex-col items-center gap-2" aria-label="게임 목록">
          <ServiceTile active={pathname.startsWith("/service/")} pending={newCounts[SERVICE_RAIL_KEY] ?? 0} />

          <div className="w-8 border-t border-line my-1" aria-hidden="true" />

          {games.map((game) => {
            const active = pathname.startsWith(`/games/${game.id}/`);
            const logoUrl = getGameLogoPublicUrl(game.logoPath);
            const pending = newCounts[game.id] ?? 0;
            return (
              <Link
                key={game.id}
                href={`/games/${game.id}/inquiries`}
                title={pending > 0 ? `${game.name} · 접수 ${pending}건` : game.name}
                aria-current={active ? "page" : undefined}
                className={`${TILE} ${active ? TILE_ACTIVE : TILE_IDLE}`}
              >
                {logoUrl ? (
                  <Image src={logoUrl} alt={game.name} width={40} height={40} className="w-10 h-10 rounded-xl object-cover" unoptimized />
                ) : (
                  <span className="w-10 h-10 bg-ground border border-line rounded-xl flex items-center justify-center font-semibold text-muted">
                    {game.name.charAt(0)}
                  </span>
                )}
                <NewBadge pending={pending} />
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            title="게임 추가"
            aria-label="게임 추가"
            className="w-10 h-10 rounded-xl border border-dashed border-line text-muted hover:text-accent hover:border-accent flex items-center justify-center text-xl leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span aria-hidden="true">+</span>
          </button>
        </nav>

        <button
          type="button"
          onClick={handleLogout}
          title="로그아웃"
          className="w-10 h-10 rounded-xl text-muted hover:text-ink hover:bg-ground flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className="sr-only">로그아웃</span>
        </button>
      </aside>

      {showAddModal && (
        <Dialog labelledBy="add-game-title" onClose={requestCloseAddModal} className="max-w-md">
          <div className="flex items-center justify-between mb-4">
            <h2 id="add-game-title" className="text-lg font-bold">
              게임 추가
            </h2>
            <button
              type="button"
              onClick={requestCloseAddModal}
              className="text-muted hover:text-ink text-xl leading-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
          {confirmClose && (
            <div role="alertdialog" aria-label="닫기 확인" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="flex-1 min-w-0">작성 중인 내용이 사라집니다. 닫을까요?</span>
              <button type="button" onClick={closeAddModal} className="rounded-md bg-amber-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-800 transition-colors">
                닫기
              </button>
              <button type="button" onClick={() => setConfirmClose(false)} className="rounded-md px-2.5 py-1 text-xs hover:bg-amber-100 transition-colors">
                계속 작성
              </button>
            </div>
          )}
          <GameForm
            onDirtyChange={handleDirtyChange}
            onCreated={(game, warning) => {
              if (warning) {
                // Keep the dialog open so the inline warning stays readable.
                router.refresh();
                return;
              }
              closeAddModal();
              router.push(`/games/${game.id}/inquiries`);
              router.refresh();
            }}
          />
        </Dialog>
      )}
    </>
  );
}
