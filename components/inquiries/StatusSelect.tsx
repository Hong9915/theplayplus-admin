"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InquiryStatus } from "@/lib/inquiries";

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
      <label className="flex items-center gap-2">
        <span>상태</span>
        <select
          value={status}
          onChange={(e) => handleChange(e.target.value as InquiryStatus)}
          className="bg-black border border-white/20 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
    </div>
  );
}
