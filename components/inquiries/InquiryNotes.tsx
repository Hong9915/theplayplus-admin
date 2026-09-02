"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { NoteRow } from "@/lib/notes";
import { emailLocalPart, formatReceivedAt } from "@/lib/format";

export default function InquiryNotes({ inquiryId, notes }: { inquiryId: string; notes: NoteRow[] }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = content.trim();
    if (trimmed === "") {
      return;
    }

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
    <section className="bg-panel border border-line rounded-2xl p-4">
      <h2 className="font-semibold mb-3">
        내부 메모 <span className="text-sm font-normal text-muted">운영자 전용 · 사용자에게 보이지 않음</span>
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder="처리 과정, 확인한 내용 등을 기록합니다."
          aria-label="내부 메모"
          className="bg-ground border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="self-start border border-line rounded-lg px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50 transition-colors"
        >
          메모 추가
        </button>
      </form>

      <div className="mt-4 pt-4 border-t border-line">
        {notes.length === 0 ? (
          <p className="text-sm text-muted">등록된 메모가 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {notes.map((note) => (
              <li key={note.id} className="text-sm">
                <p className="text-xs text-muted mb-1">
                  <span title={note.authorEmail}>{emailLocalPart(note.authorEmail)}</span>
                  {" · "}
                  {formatReceivedAt(note.createdAt)}
                </p>
                <p className="whitespace-pre-wrap">{note.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
