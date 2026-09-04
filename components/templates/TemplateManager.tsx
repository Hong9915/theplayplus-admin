"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { TemplateRow } from "@/lib/templates";

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
    "bg-ground border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors";

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-panel border border-line rounded-2xl p-4">
        <h2 className="font-semibold mb-3">템플릿 추가</h2>
        <form onSubmit={handleCreate} className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="템플릿 제목"
            placeholder="템플릿 제목"
            className={inputClass}
          />
          <select
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
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            aria-label="템플릿 내용"
            placeholder="답변에 삽입될 본문을 작성합니다."
            className={inputClass}
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="self-start border border-line rounded-lg px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50 transition-colors"
          >
            템플릿 추가
          </button>
        </form>
      </section>

      <section className="bg-panel border border-line rounded-2xl p-4">
        <h2 className="font-semibold mb-3">등록된 템플릿</h2>
        {templates.length === 0 ? (
          <p className="text-sm text-muted">등록된 템플릿이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {templates.map((template) => (
              <li key={template.id} className="border-b border-line last:border-b-0 pb-3 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium flex items-center gap-2">
                      {template.title}
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
                    onClick={() => handleAutoSend(template.id, !template.autoSend)}
                    title="켜면 이 유형의 새 문의에 이 템플릿이 자동으로 발송됩니다. 같은 유형에는 하나만 켤 수 있습니다."
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
                <p className="whitespace-pre-wrap text-sm mt-2 text-muted">{template.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
