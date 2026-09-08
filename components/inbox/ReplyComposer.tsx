"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { handleTabListKeyDown, tabProps } from "@/components/ui/tabs";
import StatusMessage from "@/components/ui/StatusMessage";
import { useSuggestion } from "@/components/inquiries/useSuggestion";
import { evidenceKind, type EvidenceKind } from "@/lib/suggest-evidence";

type Mode = "reply" | "note";
const MODES: readonly Mode[] = ["reply", "note"];
const TAB_PREFIX = "composer";
const AUTOSAVE_DELAY_MS = 2000;
/** 입력창이 늘어나는 상한. 그 위로는 안에서 스크롤한다. */
const MAX_BOX_HEIGHT_PX = 288;

/**
 * 대화 열 바닥의 입력 상자. 상자 하나가 상태를 말한다: 답변이면 흰 종이, 내부 메모면
 * 노란 종이, AI가 쓰는 중이면 주황 점선. 답변 글과 메모 글은 따로 기억한다.
 * 초안은 입력이 멈추면 조용히 저장한다(버튼·안내 없음). 템플릿 삽입은 없다.
 */
export default function ReplyComposer({
  inquiryId,
  replyEmail,
  initialDraft,
  autosaveDelayMs = AUTOSAVE_DELAY_MS,
}: {
  inquiryId: string;
  replyEmail: string;
  initialDraft: string | null;
  /** 테스트에서 짧게 줄이기 위한 값. 화면에서는 기본값을 쓴다. */
  autosaveDelayMs?: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("reply");
  const [replyText, setReplyText] = useState(initialDraft ?? "");
  const [noteText, setNoteText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "warning" | "error">("success");
  // AI 제안이 덮어쓰기 전의 글. null이면 되돌릴 것이 없다.
  const [previous, setPrevious] = useState<string | null>(null);
  const [draftWasEmpty, setDraftWasEmpty] = useState(true);
  const lastSavedRef = useRef(initialDraft ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestion = useSuggestion(inquiryId);
  const writing = suggestion.status === "streaming";
  const prevStatusRef = useRef(suggestion.status);

  const isReply = mode === "reply";
  // 쓰는 동안은 제안 조각을 그대로 보여주고, 끝나면 replyText로 옮겨 편집할 수 있게 한다.
  const value = isReply ? (writing ? suggestion.text : replyText) : noteText;

  // 스트림이 끝난 순간 한 번만 입력창에 옮긴다. 아무것도 안 왔으면 이전 글을 그대로 둔다.
  useEffect(() => {
    const was = prevStatusRef.current;
    prevStatusRef.current = suggestion.status;
    if (was !== "streaming" || suggestion.status === "streaming") return;
    if (suggestion.text !== "") {
      setReplyText(suggestion.text);
    } else {
      setPrevious(null);
    }
  }, [suggestion.status, suggestion.text]);

  // 내용에 맞춰 상자를 늘리고, 상한을 넘으면 안에서 스크롤한다.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) {
      el.style.height = `${Math.min(el.scrollHeight, MAX_BOX_HEIGHT_PX)}px`;
    }
    // 쓰는 중에는 새 글이 바닥에 붙으므로 바닥을 따라간다.
    if (writing) el.scrollTop = el.scrollHeight;
  }, [value, mode, writing]);

  // 입력이 멈추고 잠시 뒤 초안을 조용히 저장한다. 실패는 표시하지 않는다 — 다음 입력 때 다시 시도된다.
  useEffect(() => {
    if (submitting || writing) return;
    if (replyText === lastSavedRef.current) return;

    const timer = setTimeout(async () => {
      const snapshot = replyText;
      try {
        const response = await fetch(`/api/inquiries/${inquiryId}/draft`, {
          method: "PUT",
          body: JSON.stringify({ draftReply: snapshot }),
        });
        const json = (await response.json()) as { success: boolean };
        if (json.success) lastSavedRef.current = snapshot;
      } catch {
        // 다음 입력 때 다시 시도된다.
      }
    }, autosaveDelayMs);

    return () => clearTimeout(timer);
  }, [replyText, inquiryId, submitting, writing, autosaveDelayMs]);

  function handleChange(next: string) {
    if (isReply) {
      setReplyText(next);
      // 손을 대는 순간부터는 관리자의 글이다. 되돌릴 것이 없다.
      setPrevious(null);
    } else {
      setNoteText(next);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // 이메일이라 Enter는 줄바꿈이다. Cmd/Ctrl+Enter로만 보낸다.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  function changeMode(next: Mode) {
    setMode(next);
    setMessage(null);
  }

  function handleSuggest() {
    setMessage(null);
    setPrevious(replyText);
    setDraftWasEmpty(replyText.trim() === "");
    void suggestion.start(replyText);
  }

  function handleUndo() {
    if (previous === null) return;
    setReplyText(previous);
    setPrevious(null);
    suggestion.reset();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (writing) return;
    if (isReply) await sendReply();
    else await saveNote();
  }

  async function sendReply() {
    if (replyText.trim() === "") return;
    setSubmitting(true);
    setMessage(null);

    let json: { success: boolean; warning?: string };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/reply`, {
        method: "POST",
        body: JSON.stringify({ replyContent: replyText }),
      });
      json = await response.json();
    } catch {
      json = { success: false };
    }
    setSubmitting(false);

    if (!json.success) {
      setMessageTone("error");
      setMessage("발송 실패, 다시 시도해주세요.");
      return;
    }

    setReplyText("");
    setPrevious(null);
    suggestion.reset();
    // 서버가 초안을 비웠으니 자동 저장이 빈 초안을 다시 보내지 않게 맞춘다.
    lastSavedRef.current = "";
    router.refresh();

    // 메일은 나갔지만 대화 기록 저장이 실패한 경우. 되돌릴 수 없으니 알리기만 한다.
    if (json.warning === "message_save_failed") {
      setMessageTone("warning");
      setMessage("답변은 발송되었지만 대화 기록 저장에는 실패했습니다. 아래 대화 목록에 표시되지 않을 수 있습니다.");
      return;
    }
    setMessageTone("success");
    setMessage("답변이 발송되었습니다.");
  }

  async function saveNote() {
    const trimmed = noteText.trim();
    if (trimmed === "") return;
    setSubmitting(true);
    setMessage(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/notes`, {
        method: "POST",
        body: JSON.stringify({ content: trimmed }),
      });
      json = await response.json();
    } catch {
      json = { success: false };
    }
    setSubmitting(false);

    if (!json.success) {
      setMessageTone("error");
      setMessage("메모 저장에 실패했습니다.");
      return;
    }
    // 저장된 메모는 타임라인에 나타나므로 여기서는 비우기만 한다.
    setNoteText("");
    router.refresh();
  }

  const settled = suggestion.status === "done" || suggestion.status === "stopped" || suggestion.status === "error";
  const caption = !isReply
    ? null
    : suggestion.status === "stopped"
      ? "생성이 중단됐습니다. 여기까지 온 내용은 그대로 쓸 수 있습니다."
      : suggestion.status === "done"
        ? draftWasEmpty
          ? "AI가 쓴 제안입니다. 검토 뒤 발송하세요."
          : "초안을 다듬었습니다. 검토 뒤 발송하세요."
        : null;
  const showUndo = isReply && previous !== null && settled;
  const showEvidence = isReply && settled && suggestion.evidence.length > 0;
  const showSuggestRow = isReply && (writing || settled) && (caption !== null || showUndo || showEvidence || suggestion.warnings.length > 0);

  const box = writing
    ? "border-dashed border-accent bg-panel"
    : isReply
      ? "border-line bg-panel focus-within:border-muted"
      : "border-amber-200 bg-amber-50 focus-within:border-amber-400";

  const tabClass = (active: boolean) =>
    `h-7 px-2.5 inline-flex items-center rounded-md text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
      active
        ? isReply
          ? "bg-ground text-ink font-semibold"
          : "bg-amber-100 text-amber-900 font-semibold"
        : "text-muted hover:text-ink"
    }`;

  const sendClass = isReply
    ? "bg-accent text-white hover:bg-accent/90 focus-visible:ring-accent/50"
    : "bg-amber-700 text-white hover:bg-amber-700/90 focus-visible:ring-amber-400";

  return (
    <div className="px-5 pt-3 pb-3 border-t border-line bg-panel">
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        data-testid="composer"
        data-mode={mode}
        data-writing={writing || undefined}
        className={`flex flex-col rounded-2xl border transition-colors ${box}`}
      >
        <textarea
          ref={textareaRef}
          name={isReply ? "replyContent" : "note"}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          readOnly={writing}
          rows={2}
          aria-label={isReply ? "답변 내용" : "내부 메모"}
          aria-busy={writing || undefined}
          placeholder={isReply ? "답변을 입력하세요. ⌘ Enter로 발송합니다." : "처리 과정, 확인한 내용을 적습니다. 사용자에게 보이지 않습니다."}
          className="w-full bg-transparent px-4 pt-3 pb-1 text-sm leading-relaxed resize-none focus:outline-none placeholder:text-muted/70"
        />
        <div className="flex items-center gap-1 px-2 pb-2 min-w-0">
          <div
            role="tablist"
            aria-label="작성 종류"
            className="flex items-center gap-0.5 shrink-0"
            onKeyDown={(event) => handleTabListKeyDown(event, MODES, mode, TAB_PREFIX, changeMode)}
          >
            <button {...tabProps(TAB_PREFIX, "reply", isReply)} aria-controls={undefined} onClick={() => changeMode("reply")} className={tabClass(isReply)}>
              답변
            </button>
            <button {...tabProps(TAB_PREFIX, "note", !isReply)} aria-controls={undefined} onClick={() => changeMode("note")} className={tabClass(!isReply)}>
              메모
            </button>
          </div>

          {isReply && <span className="w-px h-4 bg-line mx-1 shrink-0" aria-hidden="true" />}
          {isReply && !writing && (
            <button
              type="button"
              onClick={handleSuggest}
              disabled={submitting}
              className="h-7 px-2.5 rounded-md text-xs text-muted hover:text-ink hover:bg-ground disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              AI 답변 추천
            </button>
          )}
          {writing && (
            <span className="flex items-center gap-2 text-xs text-accent pl-1.5" role="status" aria-live="polite">
              <span className="inline-block w-[2px] h-[1em] bg-accent animate-pulse motion-reduce:animate-none" aria-hidden="true" />
              쓰는 중
              <button
                type="button"
                onClick={suggestion.stop}
                className="text-muted hover:text-ink underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
              >
                중단
              </button>
            </span>
          )}

          {isReply && <span className="ml-auto text-[11px] text-muted truncate min-w-0">받는 사람 {replyEmail}</span>}
          <button
            type="submit"
            disabled={submitting || writing}
            title="⌘/Ctrl+Enter"
            className={`${isReply ? "" : "ml-auto"} shrink-0 h-7 px-3.5 rounded-full text-xs font-semibold disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-panel ${sendClass}`}
          >
            {isReply ? (submitting ? "발송 중…" : "발송") : submitting ? "저장 중…" : "메모 남기기"}
          </button>
        </div>
      </form>

      <StatusMessage tone={messageTone} className="text-sm mt-2">
        {message}
      </StatusMessage>
      <StatusMessage tone="error" className="text-sm mt-2">
        {isReply ? suggestion.error : null}
      </StatusMessage>

      {showSuggestRow && (
        <div className="flex flex-col gap-1 mt-2 px-1 text-xs">
          {(caption || showUndo) && (
            <p className="flex items-center gap-3 text-muted">
              {caption && <span>{caption}</span>}
              {showUndo && (
                <button
                  type="button"
                  onClick={handleUndo}
                  className="text-ink underline underline-offset-2 hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
                >
                  되돌리기
                </button>
              )}
            </p>
          )}
          {suggestion.warnings.map((warning) => (
            <p key={warning} className="text-amber-700" role="status">
              {warning}
            </p>
          ))}
          {showEvidence && (
            <ul aria-label="참고한 자료" className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {suggestion.evidence.map((item) => {
                const kind = evidenceKind(item);
                return (
                  <li key={item} data-kind={kind} className="flex items-center gap-1.5 text-[13px] text-ink">
                    <EvidenceIcon kind={kind} />
                    {item}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** 근거 종류를 알리는 12px 선 아이콘. 글자가 정보를 다 담고 있어 장식은 없다. */
function EvidenceIcon({ kind }: { kind: EvidenceKind }) {
  const common = { width: 12, height: 12, viewBox: "0 0 12 12", fill: "none", stroke: "currentColor", strokeWidth: 1.25, "aria-hidden": true, className: "text-muted shrink-0" };
  switch (kind) {
    case "sheet":
      return (
        <svg {...common}>
          <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
          <path d="M1.5 5h9M1.5 8h9M5 1.5v9" />
        </svg>
      );
    case "doc":
      return (
        <svg {...common}>
          <path d="M3 1.5h4l2.5 2.5v6.5H3z" />
          <path d="M7 1.5V4h2.5M4.5 6.5h3M4.5 8.5h3" />
        </svg>
      );
    case "reply":
      return (
        <svg {...common}>
          <path d="M4.5 2.5 1.5 5.5l3 3" />
          <path d="M1.5 5.5h5a4 4 0 0 1 4 4v1" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2" />
        </svg>
      );
  }
}
