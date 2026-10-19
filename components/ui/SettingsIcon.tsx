import type { ReactNode } from "react";

/** 설정 행 앞의 40px 아이콘 칸. children은 24 격자 SVG 경로. */
export default function SettingsIcon({ children }: { children: ReactNode }) {
  return (
    <span className="w-10 h-10 shrink-0 rounded-[11px] bg-well flex items-center justify-center text-ink-2">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </span>
  );
}
