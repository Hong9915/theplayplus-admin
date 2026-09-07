"use client";

import { useState } from "react";
import { readNdjson } from "@/lib/ndjson";
import type { SuggestEvent } from "@/lib/suggest";
import { splitSuggestion } from "@/lib/suggest-evidence";
import StatusMessage from "@/components/ui/StatusMessage";

// 실패 원인을 구분해 보여줘야 관리자가 무엇을 고쳐야 할지 안다.
const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "OPENAI_API_KEY가 설정되지 않았습니다.",
  refused: "안전 필터에 걸려 추천을 만들지 못했습니다.",
  not_found: "문의를 찾을 수 없습니다.",
};

const GENERIC_ERROR = "추천 생성에 실패했습니다.";

// 근거를 못 모은 채 만든 추천은 그만큼만 믿어야 한다. 본문 위에 알린다.
function warningMessage(event: Extract<SuggestEvent, { type: "warning" }>): string {
  if (event.reason === "sources_unavailable") {
    const suffix = event.sourceTitle ? ` (자료: ${event.sourceTitle})` : "";
    return `운영 자료를 읽지 못해 자료 없이 작성했습니다.${suffix}`;
  }
  return "유사 문의 검색이 안 돼 같은 유형의 최근 답변만 참고했습니다.";
}

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
  // 모델이 준 전체 텍스트(근거 포함). 본문/근거는 그릴 때마다 나눈다.
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleSuggest() {
    setLoading(true);
    setError(null);
    setWarnings([]);
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
          } else if (event.type === "warning") {
            setWarnings((current) => [...current, warningMessage(event)]);
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
    setSuggestion(text.trim() ? text : null);
  }

  const parsed = suggestion === null ? null : splitSuggestion(suggestion);
  const body = parsed ? parsed.body.trim() : "";
  const evidence = parsed ? parsed.evidence : [];

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

      <StatusMessage className="text-sm">{error}</StatusMessage>

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-amber-700" role="status">
          {warnings.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {/* 작성 중인 글을 말없이 덮어쓰지 않도록 미리보기를 거친다. */}
      {parsed && (
        <div className="border border-line rounded-lg p-3 bg-ground">
          {/* 살아 있는 영역은 상태 줄에만 둔다. 본문까지 live면 조각이 올 때마다 전체를 다시 읽는다. */}
          <p className="text-xs text-muted mb-2" role="status" aria-live="polite">
            {loading ? "추천 답변 생성 중…" : "추천 답변 (아직 적용되지 않았습니다)"}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm" aria-busy={loading || undefined}>
            {body}
            {loading && <span className="inline-block w-[2px] h-[1em] align-text-bottom bg-accent ml-0.5 animate-pulse motion-reduce:animate-none" aria-hidden="true" />}
          </p>
          {/* 시트 사실이 맞는지 관리자가 바로 확인하도록 근거는 본문과 떼어 보여준다. 답변에는 안 들어간다. */}
          {evidence.length > 0 && (
            <div className="mt-3 text-xs text-muted">
              <p className="font-medium">참고한 자료</p>
              <ul className="mt-1 list-disc pl-4">
                {evidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {/* 생성이 끝나기 전에는 적용하지 못하게 한다. 반쯤 온 글을 적용하면
              나머지가 어디로 갔는지 관리자가 알 수 없다. */}
          {!loading && (
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => {
                  onApply(body);
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
