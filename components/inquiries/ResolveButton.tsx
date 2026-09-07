"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InquiryStatus } from "@/lib/inquiries";
import StatusMessage from "@/components/ui/StatusMessage";

/**
 * 답변을 보내면 처리중이 기본이라 완료로 바꾸는 손이 한 번 더 간다.
 * 상태 셀렉트까지 가지 않고 한 번에 끝내는 버튼. 완료된 건은 다시 열 수 있다.
 */
export default function ResolveButton({
  inquiryId,
  currentStatus,
}: {
  inquiryId: string;
  currentStatus: InquiryStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolved = currentStatus === "resolved";
  const target: InquiryStatus = resolved ? "in_progress" : "resolved";

  async function handleClick() {
    setBusy(true);
    setError(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: target }),
      });
      json = await response.json();
    } catch {
      setBusy(false);
      setError("상태 변경에 실패했습니다.");
      return;
    }
    setBusy(false);

    if (!json.success) {
      setError("상태 변경에 실패했습니다.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <StatusMessage className="text-sm">{error}</StatusMessage>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={
          resolved
            ? "border border-line rounded-lg px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50 transition-colors"
            : "bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        }
      >
        {busy ? "변경 중…" : resolved ? "다시 열기" : "완료로 표시"}
      </button>
    </div>
  );
}
