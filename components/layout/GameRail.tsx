"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import type { GameRow } from "@/lib/categories";
import { getGameLogoPublicUrl } from "@/lib/storage";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import GameForm from "@/components/games/GameForm";

export default function GameRail({ games }: { games: GameRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [showAddModal, setShowAddModal] = useState(false);

  async function handleLogout() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <aside className="w-16 shrink-0 h-screen sticky top-0 bg-panel border-r border-line flex flex-col items-center py-3 gap-2">
        <div
          className="w-10 h-10 rounded-xl bg-ink text-white flex items-center justify-center font-bold text-sm select-none"
          title="THE PLAY+ Admin"
        >
          P+
        </div>

        <div className="w-8 border-t border-line my-1" />

        <nav className="flex-1 w-full overflow-y-auto flex flex-col items-center gap-2" aria-label="게임 목록">
          {games.map((game) => {
            const active = pathname.startsWith(`/games/${game.id}/`);
            const logoUrl = getGameLogoPublicUrl(game.logoPath);
            return (
              <Link
                key={game.id}
                href={`/games/${game.id}/inquiries`}
                title={game.name}
                aria-current={active ? "page" : undefined}
                className={`w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center transition-all ${
                  active
                    ? "ring-2 ring-accent ring-offset-2 ring-offset-panel"
                    : "opacity-70 hover:opacity-100 hover:ring-2 hover:ring-line hover:ring-offset-2 hover:ring-offset-panel"
                }`}
              >
                {logoUrl ? (
                  <Image src={logoUrl} alt={game.name} width={40} height={40} className="w-10 h-10 object-cover" unoptimized />
                ) : (
                  <span className="w-10 h-10 bg-ground border border-line rounded-xl flex items-center justify-center font-semibold text-muted">
                    {game.name.charAt(0)}
                  </span>
                )}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            title="게임 추가"
            className="w-10 h-10 rounded-xl border border-dashed border-line text-muted hover:text-accent hover:border-accent flex items-center justify-center text-xl leading-none transition-colors"
          >
            +
          </button>
        </nav>

        <button
          type="button"
          onClick={handleLogout}
          title="로그아웃"
          className="w-10 h-10 rounded-xl text-muted hover:text-ink hover:bg-ground flex items-center justify-center transition-colors"
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
        <div
          className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-6"
          role="dialog"
          aria-modal="true"
          aria-label="게임 추가"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddModal(false);
            }
          }}
        >
          <div className="bg-panel rounded-2xl border border-line shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">게임 추가</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-muted hover:text-ink text-xl leading-none"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <GameForm
              onCreated={(game) => {
                setShowAddModal(false);
                router.push(`/games/${game.id}/inquiries`);
                router.refresh();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
