"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Dialog from "@/components/ui/Dialog";
import StatusMessage from "@/components/ui/StatusMessage";

/** 상세 패널 맨 아래의 문의 삭제. 지우고 나면 같은 필터의 목록으로 돌아간다. */
export default function DeleteInquiryButton({
  inquiryId,
  inquiryNo,
  afterDeleteHref,
}: {
  inquiryId: string;
  inquiryNo: string | null;
  afterDeleteHref: string;
}) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = `delete-inquiry-${inquiryId}-title`;

  async function handleDelete() {
    setDeleting(true);
    setError(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}`, { method: "DELETE" });
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

    router.push(afterDeleteHref);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        className="h-8 px-3 rounded-lg text-[13px] font-semibold text-heat-hot ring-1 ring-inset ring-heat-hot hover:bg-heat-hot/5 active:bg-heat-hot/10 transition-colors focus:outline-none focus-visible:ring-2"
      >
        문의 삭제…
      </button>

      {showConfirm && (
        <Dialog labelledBy={titleId} onClose={() => setShowConfirm(false)} dismissDisabled={deleting} className="max-w-sm">
          <h2 id={titleId} className="text-lg font-bold mb-2">
            문의 삭제
          </h2>
          <p className="text-sm text-muted mb-4">
            {inquiryNo ? (
              <>
                문의 <span className="font-semibold text-ink">{inquiryNo}</span>을(를)
              </>
            ) : (
              "이 문의를"
            )}{" "}
            삭제하면 대화·메모·처리 기록과 첨부파일이 모두
            삭제됩니다. 되돌릴 수 없습니다.
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
