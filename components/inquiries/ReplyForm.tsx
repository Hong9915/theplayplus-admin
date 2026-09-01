"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function ReplyForm({ inquiryId }: { inquiryId: string }) {
  const router = useRouter();
  const [replyContent, setReplyContent] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/reply`, {
        method: "POST",
        body: JSON.stringify({ replyContent }),
      });
      json = await response.json();
    } catch {
      setSubmitting(false);
      setMessage("발송 실패, 다시 시도해주세요.");
      return;
    }
    setSubmitting(false);

    if (!json.success) {
      setMessage("발송 실패, 다시 시도해주세요.");
      return;
    }

    setMessage("답변이 발송되었습니다.");
    setReplyContent("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span>답변 내용</span>
        <textarea
          value={replyContent}
          onChange={(e) => setReplyContent(e.target.value)}
          required
          rows={6}
          className="bg-black border border-white/20 rounded px-3 py-2"
        />
      </label>
      {message && <p className="text-sm">{message}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="bg-accent text-white rounded px-4 py-2 disabled:opacity-50 self-start"
      >
        답변 발송
      </button>
    </form>
  );
}
