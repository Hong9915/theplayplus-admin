"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { TemplateRow } from "@/lib/templates";
import TemplatePicker from "@/components/inquiries/TemplatePicker";
import SuggestButton from "@/components/inquiries/SuggestButton";

const AUTOSAVE_DELAY_MS = 2000;

export default function ReplyForm({
  inquiryId,
  initialDraft,
  templates,
  typeKey,
  autosaveDelayMs = AUTOSAVE_DELAY_MS,
}: {
  inquiryId: string;
  initialDraft: string | null;
  templates: TemplateRow[];
  typeKey: string;
  /** 테스트에서 짧게 줄이기 위한 값. 화면에서는 기본값을 쓴다. */
  autosaveDelayMs?: number;
}) {
  const router = useRouter();
  const [replyContent, setReplyContent] = useState(initialDraft ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "warning" | "error">("success");
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [pendingReplace, setPendingReplace] = useState<string | null>(null);
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const lastSavedRef = useRef(initialDraft ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 템플릿이나 AI 추천으로 긴 글이 들어오면 스크롤 없이 한눈에 보이도록
  // 입력창을 내용 높이에 맞춘다. 줄이는 건 rows가 최소 높이로 막는다.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) {
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [replyContent]);

  // 입력이 멈추고 잠시 뒤 초안을 조용히 저장한다. 브라우저를 닫거나 다른
  // 문의로 넘어가도 쓰던 글이 남는다. 실패는 표시하지 않는다 — 수동 저장
  // 버튼이 있고, 자동 저장 오류로 작성 흐름을 끊고 싶지 않다.
  useEffect(() => {
    if (submitting || savingDraft) return;
    if (replyContent === lastSavedRef.current) return;

    const timer = setTimeout(async () => {
      const snapshot = replyContent;
      try {
        const response = await fetch(`/api/inquiries/${inquiryId}/draft`, {
          method: "PUT",
          body: JSON.stringify({ draftReply: snapshot }),
        });
        const json = (await response.json()) as { success: boolean };
        if (json.success) {
          lastSavedRef.current = snapshot;
          setAutosavedAt(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
        }
      } catch {
        // 다음 입력 때 다시 시도된다.
      }
    }, autosaveDelayMs);

    return () => clearTimeout(timer);
  }, [replyContent, inquiryId, submitting, savingDraft, autosaveDelayMs]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd+Enter(맥) / Ctrl+Enter(윈도우)로 발송. 긴 답변을 쓰고 마우스로
    // 버튼까지 가지 않아도 된다.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  // 템플릿 삽입과 추천 적용은 작성 중인 글을 말없이 덮어쓰지 않는다.
  // 비어 있으면 그냥 넣고, 내용이 있으면 한 번 경고한 뒤 두 번째에 대체한다.
  // 브라우저 confirm()은 쓰지 않는다.
  function applyText(next: string) {
    if (replyContent.trim() === "" || pendingReplace === next) {
      setReplyContent(next);
      setPendingReplace(null);
      setMessage(null);
      return;
    }
    setPendingReplace(next);
    setMessageTone("warning");
    setMessage("작성 중인 내용을 대체합니다. 한 번 더 선택하면 대체됩니다.");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    let json: { success: boolean; warning?: string };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/reply`, {
        method: "POST",
        body: JSON.stringify({ replyContent }),
      });
      json = await response.json();
    } catch {
      setSubmitting(false);
      setMessageTone("error");
      setMessage("발송 실패, 다시 시도해주세요.");
      return;
    }
    setSubmitting(false);

    if (!json.success) {
      setMessageTone("error");
      setMessage("발송 실패, 다시 시도해주세요.");
      return;
    }

    setReplyContent("");
    // 서버가 초안을 비웠으니 자동 저장이 빈 초안을 다시 보내지 않게 맞춘다.
    lastSavedRef.current = "";
    setAutosavedAt(null);
    router.refresh();

    // 메일 발송 자체는 성공했지만 대화 기록 저장은 실패한 경우다. 발송을
    // 되돌릴 수 없으니, "대화" 카드에 이 답변이 안 보일 수 있다는 걸 알린다.
    if (json.warning === "message_save_failed") {
      setMessageTone("warning");
      setMessage("답변은 발송되었지만 대화 기록 저장에는 실패했습니다. 아래 대화 목록에 표시되지 않을 수 있습니다.");
      return;
    }

    setMessageTone("success");
    setMessage("답변이 발송되었습니다.");
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
      setMessageTone("error");
      setMessage("초안 저장에 실패했습니다.");
      return;
    }
    setSavingDraft(false);

    if (!json.success) {
      setMessageTone("error");
      setMessage("초안 저장에 실패했습니다.");
      return;
    }

    setMessageTone("success");
    lastSavedRef.current = replyContent;
    setMessage("초안을 저장했습니다.");
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* 카드 제목이 이미 "답변"이라 눈에 보이는 라벨은 중복이다.
          aria-label로 접근성만 남기고 시각적 중복을 없앤다. */}
      <textarea
        ref={textareaRef}
        value={replyContent}
        onChange={(e) => setReplyContent(e.target.value)}
        onKeyDown={handleKeyDown}
        required
        rows={12}
        aria-label="답변 내용"
        placeholder="사용자에게 전달할 답변을 작성합니다."
        className="bg-ground border border-line rounded-lg px-3 py-2 text-sm leading-relaxed min-h-[18rem] resize-y overflow-hidden focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
      />
      {message && (
        <p
          className={`text-sm ${
            messageTone === "success"
              ? "text-emerald-700"
              : messageTone === "warning"
                ? "text-amber-700"
                : "text-red-600"
          }`}
        >
          {message}
        </p>
      )}
      {!message && autosavedAt && <p className="text-xs text-muted">초안 자동 저장됨 · {autosavedAt}</p>}
      <div className="flex flex-wrap items-start gap-2">
        <TemplatePicker templates={templates} typeKey={typeKey} onPick={applyText} />
        <SuggestButton inquiryId={inquiryId} onApply={applyText} />
      </div>
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
        <span className="text-xs text-muted hidden sm:inline">⌘/Ctrl + Enter</span>
      </div>
    </form>
  );
}
