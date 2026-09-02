"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function ReplyForm({
  inquiryId,
  initialDraft,
}: {
  inquiryId: string;
  initialDraft: string | null;
}) {
  const router = useRouter();
  const [replyContent, setReplyContent] = useState(initialDraft ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

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

  async function handleSaveDraft() {
    setSavingDraft(true);
    setMessage(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/draft`, {
        method: "PUT",
        body: JSON.stringify({ draftReply: replyContent }),
      });
      json = await response.json();
    } catch {
      setSavingDraft(false);
      setMessage("초안 저장에 실패했습니다.");
      return;
    }
    setSavingDraft(false);

    if (!json.success) {
      setMessage("초안 저장에 실패했습니다.");
      return;
    }

    setMessage("초안을 저장했습니다.");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* 카드 제목이 이미 "답변"이라 눈에 보이는 라벨은 중복이다.
          aria-label로 접근성만 남기고 시각적 중복을 없앤다. */}
      <textarea
        value={replyContent}
        onChange={(e) => setReplyContent(e.target.value)}
        required
        rows={6}
        aria-label="답변 내용"
        placeholder="사용자에게 전달할 답변을 작성합니다."
        className="bg-ground border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
      />
      {message && <p className="text-sm">{message}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={savingDraft || submitting}
          className="border border-line rounded-lg px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50 transition-colors"
        >
          초안 저장
        </button>
        <button
          type="submit"
          disabled={submitting || savingDraft}
          className="bg-accent text-white rounded-lg px-4 py-1.5 text-sm hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:ring-offset-panel disabled:opacity-50 transition-colors"
        >
          답변 발송
        </button>
      </div>
    </form>
  );
}
