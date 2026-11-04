"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Dialog from "@/components/ui/Dialog";
import StatusMessage from "@/components/ui/StatusMessage";
import SettingsIcon from "@/components/ui/SettingsIcon";
import { SUBTITLE_HELP } from "@/components/games/GameForm";

/**
 * 게임 설정 서랍의 "부제" 행. 고객센터(theplayplus-web) 게임 선택 타일에서 이름 아래 작게 나온다.
 * 비우고 저장하면 null — 접수 폼이 이름의 콜론(:) 뒤를 부제로 쓴다.
 */
export default function GameSubtitleDialog({ gameId, subtitle }: { gameId: string; subtitle: string | null }) {
  const router = useRouter();
  const initial = subtitle ?? "";
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setValue(initial);
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    let json: { success: boolean };
    try {
      const response = await fetch(`/api/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subtitle: value }),
      });
      json = await response.json();
    } catch {
      json = { success: false };
    }
    setSaving(false);
    if (!json.success) {
      setError("저장에 실패했습니다. 다시 시도해주세요.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="부제"
        className="flex items-center gap-3.5 p-2.5 rounded-xl text-left hover:bg-well active:bg-line-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <SettingsIcon>
          <path d="M4 7h16M4 12h16M4 17h9" />
        </SettingsIcon>
        <span className="flex flex-col min-w-0">
          <span className="font-semibold text-ink">부제</span>
          <span className="text-[13px] text-muted truncate">{subtitle ? subtitle : "없음 · 이름의 콜론(:) 뒤를 씀"}</span>
        </span>
      </button>
      {open && (
        <Dialog labelledBy="game-subtitle-title" onClose={close} dismissDisabled={saving} className="max-w-md">
          <h2 id="game-subtitle-title" className="text-lg font-bold mb-4">
            부제
          </h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm">부제</span>
              <input
                type="text"
                autoComplete="off"
                data-autofocus
                maxLength={100}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-describedby="game-subtitle-dialog-help"
                className="bg-panel border border-line rounded px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent transition-colors"
              />
              <span id="game-subtitle-dialog-help" className="text-xs text-muted">
                {SUBTITLE_HELP}
              </span>
            </label>
            <StatusMessage tone="error" className="text-sm">
              {error}
            </StatusMessage>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={saving} className="rounded px-3 py-2 text-sm text-muted hover:bg-ground transition-colors">
                취소
              </button>
              <button type="submit" disabled={saving} className="bg-accent text-white rounded px-4 py-2 text-sm hover:bg-accent/90 disabled:opacity-50 transition-colors">
                {saving ? "저장 중…" : "저장"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
