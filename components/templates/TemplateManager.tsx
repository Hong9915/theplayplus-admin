"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { TemplateRow } from "@/lib/templates";
import StatusMessage from "@/components/ui/StatusMessage";

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
    "bg-ground border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent transition-colors";

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-panel border border-line rounded-2xl p-4">
        <h2 className="font-semibold mb-3">템플릿 추가</h2>
        <form onSubmit={handleCreate} className="flex flex-col gap-2">
          <input
            name="title"
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="템플릿 제목"
            placeholder="예: 결제 오류 안내…"
            className={inputClass}
          />
          <select
            name="typeKey"
            value={typeKey}
            onChange={(e) => setTypeKey(e.target.value)}
            aria-label="적용 유형"
            className={inputClass}
          >
            <option value="">공용 (모든 유형)</option>
            {Object.entries(typeLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <textarea
            name="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            aria-label="템플릿 내용"
            placeholder="답변에 삽입될 본문을 작성합니다…"
            className={inputClass}
          />
          {/* 편집 중 오류는 편집 폼 쪽에 뜬다. */}
          <StatusMessage className="text-sm">{!editing ? error : null}</StatusMessage>
          <button
            type="submit"
            disabled={submitting}
            className="self-start border border-line rounded-lg px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50 transition-colors"
          >
            {submitting ? "추가 중…" : "템플릿 추가"}
          </button>
        </form>
      </section>

      <section className="bg-panel border border-line rounded-2xl p-4">
        <h2 className="font-semibold mb-1">등록된 템플릿</h2>
        {/* 툴팁(title)은 마우스로만 볼 수 있어 눈에 보이는 도움말로 둔다. */}
        <p id="auto-send-help" className="text-xs text-muted mb-3">
          자동 발송을 켜면 그 유형의 새 문의에 이 템플릿이 30분~1시간 뒤 자동으로 발송됩니다. 같은 유형에는 하나만 켤 수 있습니다.
        </p>
        {templates.length === 0 ? (
          <p className="text-sm text-muted">등록된 템플릿이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {templates.map((template) => (
              <li key={template.id} className="border-b border-line last:border-b-0 pb-3 last:pb-0">
                {editing?.id === template.id ? (
                  <div className="flex flex-col gap-2">
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
                      className={inputClass}
                    >
                      <option value="">공용 (모든 유형)</option>
                      {Object.entries(typeLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={editing.content}
                      onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                      rows={6}
                      aria-label="템플릿 내용"
                      className={inputClass}
                    />
                    <StatusMessage className="text-sm">{error}</StatusMessage>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={submitting}
                        className="border border-accent bg-accent text-white rounded-lg px-3 py-1.5 text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        {submitting ? "저장 중…" : "저장"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(null);
                          setError(null);
                        }}
                        className="border border-line rounded-lg px-3 py-1.5 text-sm hover:bg-ground transition-colors"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words">{template.title}</span>
                      {template.autoSend && (
                        <span className="text-[11px] font-semibold text-accent bg-accent/10 rounded-full px-2 py-0.5">자동 발송 중</span>
                      )}
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      {template.typeKey === null ? "공용" : typeLabels[template.typeKey] ?? template.typeKey}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startEdit(template)}
                    className="shrink-0 text-sm text-muted hover:text-ink transition-colors"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAutoSend(template.id, !template.autoSend)}
                    aria-describedby="auto-send-help"
                    className="shrink-0 text-sm text-muted hover:text-ink transition-colors"
                  >
                    {template.autoSend ? "자동 발송 끄기" : "자동 발송 켜기"}
                  </button>
                  {pendingDelete === template.id ? (
                    <div className="flex items-center gap-2 shrink-0 text-sm">
                      <span className="text-muted">삭제할까요?</span>
                      <button
                        type="button"
                        onClick={() => handleDelete(template.id)}
                        className="text-red-600 hover:underline"
                      >
                        예
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(null)}
                        className="text-muted hover:text-ink transition-colors"
                      >
                        아니오
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(template.id)}
                      className="shrink-0 text-sm text-muted hover:text-red-600 transition-colors"
                    >
                      삭제
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm mt-2 text-muted">{template.content}</p>
                </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
