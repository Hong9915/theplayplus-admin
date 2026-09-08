"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readNdjson } from "@/lib/ndjson";
import type { SuggestEvent } from "@/lib/suggest";
import { splitSuggestion } from "@/lib/suggest-evidence";

export type SuggestionStatus = "idle" | "streaming" | "done" | "stopped" | "error";

// 실패 원인을 구분해 보여줘야 관리자가 무엇을 고쳐야 할지 안다.
const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "OPENAI_API_KEY가 설정되지 않았습니다.",
  refused: "안전 필터에 걸려 추천을 만들지 못했습니다.",
  not_found: "문의를 찾을 수 없습니다.",
};
const GENERIC_ERROR = "추천 생성에 실패했습니다.";

// 근거를 못 모은 채 만든 추천은 그만큼만 믿어야 한다.
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

/**
 * AI 답변 추천 스트림의 상태. 화면은 text를 그대로 입력창에 쓰고, 근거·경고는 따로 보여준다.
 * 텍스트는 본문만이다(구분선 뒤 근거는 evidence로 뺀다). 중단하면 받은 만큼 남는다.
 */
export function useSuggestion(inquiryId: string) {
  const [status, setStatus] = useState<SuggestionStatus>("idle");
  const [raw, setRaw] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 문의를 옮기면 진행 중인 스트림은 버린다.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(
    async (draft: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("streaming");
      setRaw("");
      setWarnings([]);
      setError(null);

      let text = "";
      let failure: string | null = null;

      try {
        const response = await fetch(`/api/inquiries/${inquiryId}/suggest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft }),
          signal: controller.signal,
        });

        // 세션 없음/문의 없음처럼 스트림을 열기 전에 거절된 경우는 JSON 한 덩어리다.
        if (!response.ok || !response.body) {
          const json = (await response.json()) as { error?: string };
          failure = json.error ?? "failed";
        } else {
          for await (const event of readNdjson(response.body)) {
            // 실제 fetch는 abort 때 읽기가 거부되지만, 그 전에 온 조각은 여기서 끊는다.
            if (controller.signal.aborted) break;
            if (!isSuggestEvent(event)) continue;
            if (event.type === "text") {
              text += event.text;
              setRaw(text);
            } else if (event.type === "warning") {
              setWarnings((current) => [...current, warningMessage(event)]);
            } else {
              failure = event.reason;
            }
          }
        }
      } catch {
        // 관리자가 중단했거나 문의를 옮긴 경우는 stop/reset이 상태를 이미 정했다.
        if (controller.signal.aborted) return;
        failure = "failed";
      }

      if (abortRef.current !== controller || controller.signal.aborted) return;
      if (failure) {
        setError(ERROR_MESSAGES[failure] ?? GENERIC_ERROR);
        setStatus("error");
      } else {
        setStatus("done");
      }
    },
    [inquiryId]
  );

  // 받은 만큼 남기고 끝낸다. 읽기 중단은 fetch가 거부하든 말든 여기서 상태를 정한다.
  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus((current) => (current === "streaming" ? "stopped" : current));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setRaw("");
    setWarnings([]);
    setError(null);
  }, []);

  const parsed = splitSuggestion(raw);
  // 끝나기 전에는 조각을 그대로 보여주고, 끝나면 앞뒤 공백을 정리해 입력창에 넣기 좋게 한다.
  const text = status === "streaming" ? parsed.body : parsed.body.trim();

  return { status, text, evidence: parsed.evidence, warnings, error, start, stop, reset };
}
