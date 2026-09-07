"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: "구글 시트 또는 문서의 URL 전체를 붙여넣으세요.",
  source_forbidden: "읽을 권한이 없습니다. 위 서비스 계정에 먼저 공유한 뒤 다시 시도하세요.",
  source_not_found: "자료를 찾을 수 없습니다. URL을 확인하세요.",
  duplicate: "이미 연결된 자료입니다.",
  not_configured: "서비스 계정이 설정되지 않았습니다.",
};

/** 구글 시트·문서 URL 하나를 받아 게임 자료로 등록한다. 종류는 서버가 URL로 판별한다. */
export default function SourceAddDialog({
  gameId,
  serviceAccountEmail,
  onClose,
}: {
  gameId: string;
  serviceAccountEmail: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${gameId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = (await response.json()) as { success: boolean; error?: string };
      if (!json.success) {
        setError(ERROR_MESSAGES[json.error ?? ""] ?? "저장하지 못했습니다.");
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30" onClick={onClose}>
      <form
        role="dialog"
        aria-label="자료 추가"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl bg-panel border border-line shadow-xl p-6 flex flex-col gap-4"
      >
        <h2 className="text-base font-bold">자료 추가</h2>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">구글 시트 또는 문서 URL</span>
          <input
            aria-label="자료 URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/… 또는 /document/d/…"
            className="rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </label>

        <div className="rounded-lg bg-ground px-3 py-2.5 text-xs leading-relaxed">
          {serviceAccountEmail ? (
            <>
              시트·문서를 아래 서비스 계정에 <strong>편집자</strong>로 공유한 뒤 추가하세요.
              <div className="mt-1 font-mono text-[12px] select-all">{serviceAccountEmail}</div>
              <div className="mt-2 text-muted">시트를 수정까지 쓰려면 탭의 첫 줄에 열 이름을 두세요(예: 이메일 / ID / VIP 단계 / 갱신일). 문서는 읽기만 합니다.</div>
            </>
          ) : (
            <>
              서비스 계정이 설정되지 않았습니다. 관리자 앱 환경변수 <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>에 서비스 계정 키(JSON 한 줄)를 넣고 재배포하세요.
            </>
          )}
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-ground">
            닫기
          </button>
          <button type="submit" disabled={saving || !url.trim()} className="rounded-lg bg-accent text-white px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
            추가
          </button>
        </div>
      </form>
    </div>
  );
}
