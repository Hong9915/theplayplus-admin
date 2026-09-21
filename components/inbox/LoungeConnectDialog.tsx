"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Dialog from "@/components/ui/Dialog";
import StatusMessage from "@/components/ui/StatusMessage";

const ERRORS: Record<string, string> = {
  invalid_lounge: "네이버 게임 라운지 주소가 아닙니다. https://game.naver.com/lounge/… 주소를 붙여넣어 주세요.",
  lounge_unreachable: "라운지를 읽을 수 없습니다. 주소를 다시 확인해주세요.",
};

/** 문의함 보기 열의 "네이버 라운지 연결". 주소를 비우고 저장하면 연결이 해제된다. */
export default function LoungeConnectDialog({ gameId, loungeId }: { gameId: string; loungeId: string | null }) {
  const router = useRouter();
  const initial = loungeId ? `https://game.naver.com/lounge/${loungeId}/home` : "";
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setUrl(initial);
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    let json: { success: boolean; error?: string };
    try {
      const response = await fetch(`/api/games/${gameId}/lounge`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loungeUrl: url }) });
      json = await response.json();
    } catch {
      json = { success: false };
    }
    setSaving(false);
    if (!json.success) {
      setError(ERRORS[json.error ?? ""] ?? "저장에 실패했습니다. 다시 시도해주세요.");
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
        className="flex items-center h-8 px-2.5 rounded-lg text-[13px] text-muted hover:bg-ground hover:text-ink transition-colors text-left"
      >
        {loungeId ? "네이버 라운지 변경" : "네이버 라운지 연결"}
      </button>
      {open && (
        <Dialog labelledBy="lounge-connect-title" onClose={close} dismissDisabled={saving} className="max-w-md">
          <h2 id="lounge-connect-title" className="text-lg font-bold mb-1">
            네이버 라운지 연결
          </h2>
          <p className="text-sm text-muted mb-4">라운지에 유저가 글·댓글을 쓰면 5분 안에 여기와 Slack으로 알려드립니다. 주소를 비우고 저장하면 연결이 해제됩니다.</p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm">라운지 주소</span>
              <input
                type="text"
                inputMode="url"
                autoComplete="off"
                data-autofocus
                placeholder="https://game.naver.com/lounge/…/home"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="bg-panel border border-line rounded px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent transition-colors"
              />
            </label>
            <StatusMessage tone="error" className="text-sm">
              {error}
            </StatusMessage>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={saving} className="rounded px-3 py-2 text-sm text-muted hover:bg-ground transition-colors">
                취소
              </button>
              <button type="submit" disabled={saving} className="bg-accent text-white rounded px-4 py-2 text-sm hover:bg-accent/90 disabled:opacity-50 transition-colors">
                {saving ? "확인 중…" : "저장"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
