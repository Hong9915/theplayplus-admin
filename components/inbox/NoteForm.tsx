"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/** 내부 메모 작성. 저장되면 타임라인에 나타나므로 여기서는 목록을 그리지 않는다. */
export default function NoteForm({ inquiryId }: { inquiryId: string }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = content.trim();
    if (trimmed === "") return;

    setSubmitting(true);
    setError(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/notes`, {
        method: "POST",
        body: JSON.stringify({ content: trimmed }),
      });
      json = await response.json();
    } catch {
      setSubmitting(false);
      setError("메모 저장에 실패했습니다.");
      return;
    }
    setSubmitting(false);

    if (!json.success) {
      setError("메모 저장에 실패했습니다.");
      return;
    }
    setContent("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <p className="text-xs text-muted">운영자 전용 · 사용자에게 보이지 않습니다.</p>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        placeholder="처리 과정, 확인한 내용 등을 기록합니다."
        aria-label="내부 메모"
        className="bg-ground border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
      />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={submitting} className="border border-line rounded-lg px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50 transition-colors">
          메모 추가
        </button>
      </div>
    </form>
  );
}
