"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InquiryPriority } from "@/lib/inquiries";
import StatusMessage from "@/components/ui/StatusMessage";

const OPTIONS: Array<{ value: InquiryPriority; label: string }> = [
  { value: "urgent", label: "긴급" },
  { value: "high", label: "높음" },
  { value: "normal", label: "보통" },
  { value: "low", label: "낮음" },
];

export default function PrioritySelect({
  inquiryId,
  currentPriority,
}: {
  inquiryId: string;
  currentPriority: InquiryPriority;
}) {
  const router = useRouter();
  const [priority, setPriority] = useState(currentPriority);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: InquiryPriority) {
    const previous = priority;
    setPriority(next);
    setError(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/priority`, {
        method: "PATCH",
        body: JSON.stringify({ priority: next }),
      });
      json = await response.json();
    } catch {
      setPriority(previous);
      setError("우선순위 변경에 실패했습니다.");
      return;
    }

    if (!json.success) {
      setPriority(previous);
      setError("우선순위 변경에 실패했습니다.");
      return;
    }

    router.refresh();
  }

  return (
    <div>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted">우선순위</span>
        <select
          value={priority}
          onChange={(e) => handleChange(e.target.value as InquiryPriority)}
          className="bg-panel border border-line rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent transition-colors"
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
