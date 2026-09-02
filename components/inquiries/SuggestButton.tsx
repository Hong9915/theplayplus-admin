"use client";

import { useState } from "react";

// 실패 원인을 구분해 보여줘야 관리자가 무엇을 고쳐야 할지 안다.
const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "GEMINI_API_KEY가 설정되지 않았습니다.",
  refused: "안전 필터에 걸려 추천을 만들지 못했습니다.",
  not_found: "문의를 찾을 수 없습니다.",
};

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

    let json: { success: boolean; suggestion?: string; error?: string };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/suggest`, { method: "POST" });
      json = await response.json();
    } catch {
      setLoading(false);
      setError("추천 생성에 실패했습니다.");
      return;
    }
    setLoading(false);

    if (!json.success || !json.suggestion) {
      setError(ERROR_MESSAGES[json.error ?? ""] ?? "추천 생성에 실패했습니다.");
      return;
    }

    setSuggestion(json.suggestion);
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
        <div className="border border-line rounded-lg p-3 bg-ground">
          <p className="text-xs text-muted mb-2">추천 답변 (아직 적용되지 않았습니다)</p>
          <p className="whitespace-pre-wrap text-sm">{suggestion}</p>
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
        </div>
      )}
    </div>
  );
}
