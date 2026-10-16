"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import StatusMessage from "@/components/ui/StatusMessage";
import {
  NOTICE_CATEGORIES,
  NOTICE_CATEGORY_LABELS,
  type GameNotice,
  type NoticeCategory,
} from "@/lib/game-pages";

const INPUT =
  "w-full bg-panel border border-line rounded px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent transition-colors";

const CATEGORY_TONE: Record<NoticeCategory, string> = {
  notice: "bg-ground text-ink",
  maintenance: "bg-red-50 text-red-700",
  update: "bg-sky-50 text-sky-700",
  event: "bg-amber-50 text-amber-700",
};

interface Draft {
  category: NoticeCategory;
  title: string;
  body: string;
  pinned: boolean;
  /** datetime-local 입력값(서울 시각). 비우면 지금. */
  publishedAt: string;
}

const EMPTY: Draft = { category: "notice", title: "", body: "", pinned: false, publishedAt: "" };

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** ISO → datetime-local 값(서울 기준). */
function toLocalInput(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
}

/** datetime-local 값(서울 기준) → ISO. 관리자는 모두 한국 시간으로 쓴다. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}:00+09:00`).toISOString();
}

function NoticeForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.title.trim() === "" || draft.body.trim() === "") return;
    setSubmitting(true);
    const ok = await onSubmit(draft);
    setSubmitting(false);
    if (ok && !onCancel) setDraft(EMPTY);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <select
          aria-label="분류"
          value={draft.category}
          onChange={(event) => setDraft({ ...draft, category: event.target.value as NoticeCategory })}
          className={INPUT}
        >
          {NOTICE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {NOTICE_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        <input
          aria-label="제목"
          placeholder="제목"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          className={INPUT}
          required
        />
      </div>
      <textarea
        aria-label="내용"
        placeholder="내용. 줄바꿈이 그대로 보입니다."
        value={draft.body}
        onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        rows={6}
        className={INPUT}
        required
      />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.pinned}
            onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })}
            className="accent-accent"
          />
          맨 위에 고정
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted">게시일</span>
          <input
            type="datetime-local"
            value={draft.publishedAt}
            onChange={(event) => setDraft({ ...draft, publishedAt: event.target.value })}
            className="bg-panel border border-line rounded px-2 py-1"
          />
          <span className="text-xs text-muted">비우면 지금. 미래 시각이면 그때 공개됩니다.</span>
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? "저장 중…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded px-4 py-2 text-sm text-muted hover:text-ink">
            취소
          </button>
        )}
      </div>
    </form>
  );
}

export default function NoticeManager({ gameId, notices }: { gameId: string; notices: GameNotice[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // 브라우저 confirm()은 쓰지 않는다. 템플릿처럼 행 안에서 한 번 더 누르게 한다.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function send(url: string, method: string, draft?: Draft): Promise<boolean> {
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        body: draft
          ? JSON.stringify({
              category: draft.category,
              title: draft.title.trim(),
              body: draft.body.trim(),
              pinned: draft.pinned,
              publishedAt: fromLocalInput(draft.publishedAt),
            })
          : undefined,
      });
      const json: { success: boolean } = await response.json();
      if (!json.success) throw new Error();
    } catch {
      setError(method === "DELETE" ? "공지를 지우지 못했습니다." : "공지를 저장하지 못했습니다.");
      return false;
    }
    router.refresh();
    return true;
  }

  const now = Date.now();

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <section className="bg-panel border border-line rounded-lg p-5 flex flex-col gap-3">
        <h2 className="text-base font-bold">새 공지</h2>
        <NoticeForm initial={EMPTY} submitLabel="공지 올리기" onSubmit={(draft) => send(`/api/games/${gameId}/notices`, "POST", draft)} />
      </section>

      <StatusMessage className="text-sm">{error}</StatusMessage>

      <section className="bg-panel border border-line rounded-lg">
        <h2 className="text-base font-bold px-5 pt-5 pb-3">
          올린 공지 <span className="text-muted font-normal tabular-nums">{notices.length}</span>
        </h2>
        {notices.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">아직 공지가 없습니다. 위에서 첫 공지를 올리면 웹사이트 공지사항 탭에 나옵니다.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {notices.map((notice) => {
              const scheduled = new Date(notice.publishedAt).getTime() > now;
              if (editing === notice.id) {
                return (
                  <li key={notice.id} className="p-5">
                    <NoticeForm
                      initial={{
                        category: notice.category,
                        title: notice.title,
                        body: notice.body,
                        pinned: notice.pinned,
                        publishedAt: toLocalInput(notice.publishedAt),
                      }}
                      submitLabel="수정 저장"
                      onSubmit={async (draft) => {
                        const ok = await send(`/api/notices/${notice.id}`, "PATCH", draft);
                        if (ok) setEditing(null);
                        return ok;
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </li>
                );
              }
              return (
                <li key={notice.id} className="px-5 py-3.5 flex items-start gap-3">
                  <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${CATEGORY_TONE[notice.category]}`}>
                    {NOTICE_CATEGORY_LABELS[notice.category]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {notice.pinned && <span className="text-accent mr-1">고정</span>}
                      {notice.title}
                    </p>
                    <p className="text-xs text-muted tabular-nums">
                      {dateFormat.format(new Date(notice.publishedAt))}
                      {scheduled && <span className="ml-2 text-amber-700">예약됨</span>}
                    </p>
                  </div>
                  {pendingDelete === notice.id ? (
                    <span className="flex items-center gap-2 text-sm shrink-0">
                      <span className="text-muted">지울까요?</span>
                      <button type="button" onClick={async () => { await send(`/api/notices/${notice.id}`, "DELETE"); setPendingDelete(null); }} className="text-red-600 font-semibold">
                        지우기
                      </button>
                      <button type="button" onClick={() => setPendingDelete(null)} className="text-muted">
                        취소
                      </button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-3 text-sm shrink-0">
                      <button type="button" onClick={() => { setPendingDelete(null); setEditing(notice.id); }} className="text-muted hover:text-ink">
                        수정
                      </button>
                      <button type="button" onClick={() => setPendingDelete(notice.id)} className="text-muted hover:text-red-600">
                        삭제
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
