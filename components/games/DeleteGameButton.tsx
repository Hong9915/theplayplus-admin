"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Dialog from "@/components/ui/Dialog";
import StatusMessage from "@/components/ui/StatusMessage";

export default function DeleteGameButton({
  gameId,
  gameName,
  inquiryCount,
}: {
  gameId: string;
  gameName: string;
  inquiryCount: number;
}) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = `delete-game-${gameId}-title`;

  async function handleDelete() {
    setDeleting(true);
    setError(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/games/${gameId}`, { method: "DELETE" });
      json = await response.json();
    } catch {
      setDeleting(false);
      setError("삭제에 실패했습니다. 다시 시도해주세요.");
      return;
    }

    if (!json.success) {
      setDeleting(false);
      setError("삭제에 실패했습니다. 다시 시도해주세요.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        className="ml-auto text-xs text-muted hover:text-red-600 border border-line hover:border-red-300 rounded-lg px-2.5 py-1.5 transition-colors"
      >
        게임 삭제
      </button>

      {showConfirm && (
        <Dialog labelledBy={titleId} onClose={() => setShowConfirm(false)} dismissDisabled={deleting} className="max-w-sm">
          <h2 id={titleId} className="text-lg font-bold mb-2">
            게임 삭제
          </h2>
          <p className="text-sm text-muted mb-4">
            &lsquo;{gameName}&rsquo;을(를) 삭제하면 접수된 문의{" "}
            <span className="font-semibold text-red-600">{inquiryCount}건</span>과 첨부파일이 모두 삭제됩니다.
            되돌릴 수 없습니다.
          </p>
          <StatusMessage className="text-sm mb-3">{error}</StatusMessage>
          <div className="flex justify-end gap-2">
            {/* 취소가 먼저 초점을 받는다. 되돌릴 수 없는 동작이라 Enter 한 번에 지워지지 않게. */}
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              disabled={deleting}
              data-autofocus
              className="text-sm text-muted hover:text-ink rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm bg-red-600 text-white rounded-lg px-3 py-2 hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50 transition-colors"
            >
              {deleting ? "삭제 중…" : "삭제"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
