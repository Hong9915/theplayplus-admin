"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  no_thread: "아직 보낸 답변이 없어 확인할 스레드가 없습니다.",
  fetch_failed: "Gmail에서 회신을 가져오지 못했습니다. 읽기 권한(gmail.readonly)이 있는지 확인하세요.",
};

/** 관리자가 눌러야 Gmail을 조회한다. 상세를 열 때마다 조회하면 느리고 할당량을 먹는다. */
export default function SyncRepliesButton({ inquiryId }: { inquiryId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setMessage(null);

    let json: { success: boolean; added?: number; error?: string };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/sync-replies`, { method: "POST" });
      json = await response.json();
    } catch {
      setLoading(false);
      setMessage("회신 확인에 실패했습니다.");
      return;
    }
    setLoading(false);

    if (!json.success) {
      setMessage(ERROR_MESSAGES[json.error ?? ""] ?? "회신 확인에 실패했습니다.");
      return;
    }

    setMessage(json.added ? `새 회신 ${json.added}건을 가져왔습니다.` : "새 회신이 없습니다.");
    if (json.added) {
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      {message && <span className="text-muted">{message}</span>}
      <button
        type="button"
        onClick={handleSync}
        disabled={loading}
        className="border border-line rounded-lg px-2.5 py-1 hover:bg-ground disabled:opacity-50 transition-colors"
      >
        {loading ? "확인 중…" : "회신 확인"}
      </button>
    </div>
  );
}
