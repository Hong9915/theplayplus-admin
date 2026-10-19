"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InquiryStatus } from "@/lib/inquiries";
import StatusMessage from "@/components/ui/StatusMessage";

const OPTIONS: Array<{ value: InquiryStatus; label: string }> = [
  { value: "new", label: "접수" },
  { value: "in_progress", label: "처리중" },
  { value: "resolved", label: "완료" },
];

export default function StatusSelect({
  inquiryId,
  currentStatus,
}: {
  inquiryId: string;
  currentStatus: InquiryStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: InquiryStatus) {
    const previous = status;
    setStatus(next);
    setError(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      json = await response.json();
    } catch {
      setStatus(previous);
      setError("상태 변경에 실패했습니다.");
      return;
    }

    if (!json.success) {
      setStatus(previous);
      setError("상태 변경에 실패했습니다.");
      return;
    }

    router.refresh();
  }

  return (
    <div>
      <label className="flex items-center justify-between gap-2 text-[13px]">
        <span className="text-muted">상태</span>
        <select
          value={status}
          onChange={(e) => handleChange(e.target.value as InquiryStatus)}
          className="appearance-none w-[150px] h-8 pl-3 pr-7 rounded-lg bg-panel ring-1 ring-inset ring-line text-[13.5px] font-medium text-ink select-chevron focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <StatusMessage className="text-sm mt-1">{error}</StatusMessage>
    </div>
  );
}
