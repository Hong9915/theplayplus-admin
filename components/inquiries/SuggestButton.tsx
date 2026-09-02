"use client";

import { useState } from "react";
import { readNdjson } from "@/lib/ndjson";
import type { SuggestEvent } from "@/lib/suggest";

// 실패 원인을 구분해 보여줘야 관리자가 무엇을 고쳐야 할지 안다.
const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "GEMINI_API_KEY가 설정되지 않았습니다.",
  refused: "안전 필터에 걸려 추천을 만들지 못했습니다.",
  not_found: "문의를 찾을 수 없습니다.",
};

const GENERIC_ERROR = "추천 생성에 실패했습니다.";

function isSuggestEvent(value: unknown): value is SuggestEvent {
  return typeof value === "object" && value !== null && "type" in value;
}

export default function SuggestButton({
  inquiryId,
  onApply,
}: {
  inquiryId: string;
  onApply: (text: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSuggest() {
    setLoading(true);
    setError(null);
    setSuggestion(null);

    let text = "";
    let failure: string | null = null;

    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/suggest`, { method: "POST" });

      // 세션 없음/문의 없음처럼 스트림을 열기 전에 거절된 경우는 JSON 한 덩어리다.
      if (!response.ok || !response.body) {
        const json = (await response.json()) as { error?: string };
        failure = json.error ?? "failed";
      } else {
        for await (const event of readNdjson(response.body)) {
          if (!isSuggestEvent(event)) continue;
          if (event.type === "text") {
            text += event.text;
            // 조각이 올 때마다 미리보기를 갱신해 생성 과정이 보이게 한다.
            setSuggestion(text);
          } else {
            failure = event.reason;
          }
        }
      }
    } catch {
      failure = "failed";
    }

    setLoading(false);

    if (failure) {
      setError(ERROR_MESSAGES[failure] ?? GENERIC_ERROR);
    }

    // 중간에 끊겨도 이미 받은 부분은 관리자가 살릴 수 있게 남긴다.
    const trimmed = text.trim();
    setSuggestion(trimmed ? trimmed : null);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleSuggest}
        disabled={loading}
        className="self-start border border-line rounded-lg px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50 transition-colors"
      >
        {loading ? "추천 생성 중…" : "AI 답변 추천"}
      </button>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* 작성 중인 글을 말없이 덮어쓰지 않도록 미리보기를 거친다. */}
      {suggestion && (
        <div className="border border-line rounded-lg p-3 bg-ground" aria-live="polite">
          <p className="text-xs text-muted mb-2">
            {loading ? "추천 답변 생성 중…" : "추천 답변 (아직 적용되지 않았습니다)"}
          </p>
          <p className="whitespace-pre-wrap text-sm">
            {suggestion}
            {loading && <span className="inline-block w-[2px] h-[1em] align-text-bottom bg-accent ml-0.5 animate-pulse" aria-hidden />}
          </p>
          {/* 생성이 끝나기 전에는 적용하지 못하게 한다. 반쯤 온 글을 적용하면
              나머지가 어디로 갔는지 관리자가 알 수 없다. */}
          {!loading && (
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => {
                  onApply(suggestion);
                  setSuggestion(null);
                }}
                className="border border-line rounded-lg px-3 py-1 text-sm hover:bg-panel transition-colors"
              >
                적용
              </button>
              <button
                type="button"
                onClick={() => setSuggestion(null)}
                className="text-sm text-muted hover:text-ink transition-colors"
              >
                버리기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
