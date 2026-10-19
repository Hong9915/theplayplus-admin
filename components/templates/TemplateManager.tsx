"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { TemplateRow } from "@/lib/templates";
import StatusMessage from "@/components/ui/StatusMessage";

const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-[9px] bg-accent text-white text-[13.5px] font-semibold hover:brightness-105 active:brightness-95 disabled:opacity-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
const BTN_GHOST =
  "inline-flex items-center h-[34px] px-3 rounded-[9px] text-[13.5px] font-semibold text-ink-2 ring-1 ring-inset ring-line hover:bg-well hover:text-ink active:bg-line-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
const BTN_TEXT =
  "shrink-0 h-8 px-2 rounded-lg text-[13px] font-medium text-muted hover:text-ink hover:bg-well active:bg-line-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

interface EditDraft {
  id: string;
  title: string;
  content: string;
  typeKey: string;
}

export default function TemplateManager({
  gameId,
  templates,
  typeLabels,
}: {
  gameId: string;
  templates: TemplateRow[];
  typeLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [typeKey, setTypeKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 브라우저 confirm()은 쓰지 않는다. 삭제 버튼을 누르면 그 행에 인라인
  // 확인이 뜨는 2단계로 만든다.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  // 수정은 목록 항목 자리에 폼을 펼치는 인라인 방식. 한 번에 하나만 편집한다.
  const [editing, setEditing] = useState<EditDraft | null>(null);
  // 추가는 매일 하는 일이 아니라 버튼 뒤에 둔다. 템플릿이 하나도 없으면 바로 펼친다.
  const [adding, setAdding] = useState(templates.length === 0);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (trimmedTitle === "" || trimmedContent === "") {
      return;
    }

    setSubmitting(true);
    setError(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/games/${gameId}/templates`, {
        method: "POST",
        body: JSON.stringify({
          typeKey: typeKey === "" ? null : typeKey,
          title: trimmedTitle,
          content: trimmedContent,
        }),
      });
      json = await response.json();
    } catch {
      setSubmitting(false);
      setError("템플릿 저장에 실패했습니다.");
      return;
    }
    setSubmitting(false);

    if (!json.success) {
      setError("템플릿 저장에 실패했습니다.");
      return;
    }

    setTitle("");
    setContent("");
    setTypeKey("");
    setAdding(false);
    router.refresh();
  }

  function startEdit(template: TemplateRow) {
    setError(null);
    setPendingDelete(null);
    setEditing({ id: template.id, title: template.title, content: template.content, typeKey: template.typeKey ?? "" });
  }

  async function handleSaveEdit() {
    if (!editing) return;
    const trimmedTitle = editing.title.trim();
    const trimmedContent = editing.content.trim();
    if (trimmedTitle === "" || trimmedContent === "") {
      return;
    }

    setSubmitting(true);
    setError(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/templates/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: trimmedTitle,
          content: trimmedContent,
          typeKey: editing.typeKey === "" ? null : editing.typeKey,
        }),
      });
      json = await response.json();
    } catch {
      setSubmitting(false);
      setError("템플릿 수정에 실패했습니다.");
      return;
    }
    setSubmitting(false);

    if (!json.success) {
      // 실패해도 편집 중인 내용은 남겨 다시 시도할 수 있게 한다.
      setError("템플릿 수정에 실패했습니다.");
      return;
    }

    setEditing(null);
    router.refresh();
  }

  async function handleAutoSend(id: string, autoSend: boolean) {
    setError(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ autoSend }),
      });
      json = await response.json();
    } catch {
      setError("자동 발송 설정에 실패했습니다.");
      return;
    }

    if (!json.success) {
      setError("자동 발송 설정에 실패했습니다.");
      return;
    }

    router.refresh();
  }

  async function handleDelete(id: string) {
    setError(null);

    let json: { success: boolean };
    try {
      const response = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      json = await response.json();
    } catch {
      setPendingDelete(null);
      setError("템플릿 삭제에 실패했습니다.");
      return;
    }

    setPendingDelete(null);

    if (!json.success) {
      setError("템플릿 삭제에 실패했습니다.");
      return;
    }

    router.refresh();
  }

  const inputClass =
    "w-full bg-panel border border-line rounded-[10px] px-3 py-2 text-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent transition-colors";

  // 공용 먼저, 그다음 유형 순서대로. 같은 유형끼리 모여 있어야 자동 발송이 어디에 켜져 있는지 한눈에 보인다.
  const typeOrder = Object.keys(typeLabels);
  const rank = (key: string | null) => (key === null ? -1 : typeOrder.indexOf(key) === -1 ? typeOrder.length : typeOrder.indexOf(key));
  const sorted = [...templates].sort((a, b) => rank(a.typeKey) - rank(b.typeKey));

  const typeOptions = (
    <>
      <option value="">공용 (모든 유형)</option>
      {Object.entries(typeLabels).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        {/* 툴팁(title)은 마우스로만 볼 수 있어 눈에 보이는 도움말로 둔다. */}
        <p id="auto-send-help" className="text-[13px] text-muted max-w-[520px]">
          자동 발송을 켜면 그 유형의 새 문의에 이 템플릿이 5분~30분 뒤 자동으로 발송됩니다. 같은 유형에는 하나만 켤 수 있습니다.
        </p>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={`${BTN_PRIMARY} shrink-0`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            새 템플릿
          </button>
        )}
      </div>

      {adding && (
        <section className="rounded-2xl bg-panel shadow-paper p-5" aria-labelledby="template-add-title">
          <h2 id="template-add-title" className="text-[15px] font-bold tracking-[-.01em] mb-3">
            새 템플릿
          </h2>
          <form onSubmit={handleCreate} className="flex flex-col gap-2.5">
            <div className="grid grid-cols-[minmax(0,1fr)_200px] gap-2.5">
              <input
                name="title"
                autoComplete="off"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-label="템플릿 제목"
                placeholder="예: 결제 오류 안내"
                className={inputClass}
              />
              <select name="typeKey" value={typeKey} onChange={(e) => setTypeKey(e.target.value)} aria-label="적용 유형" className={`${inputClass} appearance-none pr-8 select-chevron`}>
                {typeOptions}
              </select>
            </div>
            <textarea
              name="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              aria-label="템플릿 내용"
              placeholder="답변에 들어갈 본문을 작성합니다"
              className={`${inputClass} leading-[1.65]`}
            />
            {/* 편집 중 오류는 편집 폼 쪽에 뜬다. */}
            <StatusMessage className="text-sm">{!editing ? error : null}</StatusMessage>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={submitting} className={BTN_PRIMARY}>
                {submitting ? "추가 중…" : "템플릿 추가"}
              </button>
              {templates.length > 0 && (
                <button type="button" onClick={() => setAdding(false)} className={BTN_GHOST}>
                  닫기
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      {templates.length === 0 ? (
        <p className="py-10 text-center text-[14px] text-muted">등록된 템플릿이 없습니다.</p>
      ) : (
        <>
          {!adding && <StatusMessage className="text-sm">{!editing ? error : null}</StatusMessage>}
          <ul className="flex flex-col rounded-2xl bg-panel shadow-paper divide-y divide-line-soft">
            {sorted.map((template) => (
              <li key={template.id} className="px-5 py-4">
                {editing?.id === template.id ? (
                  <div className="flex flex-col gap-2.5">
                    <div className="grid grid-cols-[minmax(0,1fr)_200px] gap-2.5">
                      <input
                        name="title"
                        autoComplete="off"
                        value={editing.title}
                        onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                        aria-label="템플릿 제목"
                        className={inputClass}
                      />
                      <select
                        value={editing.typeKey}
                        onChange={(e) => setEditing({ ...editing, typeKey: e.target.value })}
                        aria-label="적용 유형"
                        className={`${inputClass} appearance-none pr-8 select-chevron`}
                      >
                        {typeOptions}
                      </select>
                    </div>
                    <textarea
                      value={editing.content}
                      onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                      rows={8}
                      aria-label="템플릿 내용"
                      className={`${inputClass} leading-[1.65]`}
                    />
                    <StatusMessage className="text-sm">{error}</StatusMessage>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={handleSaveEdit} disabled={submitting} className={BTN_PRIMARY}>
                        {submitting ? "저장 중…" : "저장"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(null);
                          setError(null);
                        }}
                        className={BTN_GHOST}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`inline-flex items-center h-[22px] px-2 rounded-md text-xs font-semibold shrink-0 ${
                          template.typeKey === null ? "bg-line-soft text-muted" : "bg-line-soft text-ink-2"
                        }`}
                      >
                        {template.typeKey === null ? "공용" : typeLabels[template.typeKey] ?? template.typeKey}
                      </span>
                      <p className="flex-1 min-w-0 text-[15px] font-semibold tracking-[-.01em] truncate">{template.title}</p>

                      {/* 상태가 눈에 보이는 스위치. 글자 버튼("켜기/끄기")은 지금 상태를 말해 주지 않는다. */}
                      <label className="flex items-center gap-2 shrink-0 text-[13px] font-medium text-ink-2 cursor-pointer">
                        자동 발송
                        <button
                          type="button"
                          role="switch"
                          aria-checked={template.autoSend}
                          aria-label="자동 발송"
                          aria-describedby="auto-send-help"
                          onClick={() => handleAutoSend(template.id, !template.autoSend)}
                          className={`relative w-[38px] h-[22px] rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                            template.autoSend ? "bg-accent" : "bg-ink/20"
                          }`}
                        >
                          <span
                            className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${
                              template.autoSend ? "translate-x-4" : ""
                            }`}
                            aria-hidden="true"
                          />
                        </button>
                      </label>

                      <span className="w-px h-4 bg-line mx-1 shrink-0" aria-hidden="true" />
                      <button type="button" onClick={() => startEdit(template)} className={BTN_TEXT}>
                        수정
                      </button>
                      {pendingDelete === template.id ? (
                        <div className="flex items-center gap-1 shrink-0 text-[13px]">
                          <span className="text-ink-2 font-medium px-1">삭제할까요?</span>
                          <button type="button" onClick={() => handleDelete(template.id)} className={`${BTN_TEXT} !text-heat-hot`}>
                            예
                          </button>
                          <button type="button" onClick={() => setPendingDelete(null)} className={BTN_TEXT}>
                            아니오
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setPendingDelete(template.id)} className={`${BTN_TEXT} hover:!text-heat-hot`}>
                          삭제
                        </button>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.65] text-ink-2 line-clamp-4">{template.content}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
