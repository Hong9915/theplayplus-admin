import type { ReactNode } from "react";

type Tone = "error" | "success" | "warning" | "muted";

const TONE: Record<Tone, string> = {
  error: "text-red-600",
  success: "text-emerald-700",
  warning: "text-amber-700",
  muted: "text-muted",
};

/**
 * 비동기 작업의 결과·오류 안내. 스크린 리더가 바뀐 내용을 읽도록 live region으로 둔다.
 * 살아 있는 영역은 내용이 바뀌기 전부터 DOM에 있어야 안내되므로, 메시지가 없을 때도
 * 시각적으로만 숨긴(sr-only) 빈 <p>를 남긴다.
 */
export default function StatusMessage({
  tone = "error",
  className = "",
  children,
}: {
  tone?: Tone;
  className?: string;
  children?: ReactNode;
}) {
  const present = children !== null && children !== undefined && children !== false && children !== "";
  return (
    <p role="status" aria-live="polite" className={present ? `${TONE[tone]} ${className}`.trim() : "sr-only"}>
      {present ? children : null}
    </p>
  );
}
