"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sourceUrl, type SourceRow } from "@/lib/source-url";

/** 게임에 연결된 구글 시트·문서 목록과 연결 해제·추가. 어시스턴트 사이드바와 자료 관리 화면이 함께 쓴다. */
export default function SourceList({
  gameId,
  sources,
  onAddSource,
  size = "sm",
}: {
  gameId: string;
  sources: SourceRow[];
  onAddSource: () => void;
  /** sm: 사이드바용 촘촘한 목록, md: 자료 관리 화면용 */
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [unlinking, setUnlinking] = useState<string | null>(null);

  async function unlink(source: SourceRow) {
    setUnlinking(source.id);
    try {
      await fetch(`/api/games/${gameId}/sources/${source.id}`, { method: "DELETE" });
    } finally {
      setUnlinking(null);
    }
    router.refresh();
  }

  const row = size === "md" ? "px-2.5 py-2 pr-9 text-sm" : "px-1.5 py-1 pr-7 text-sm";

  return (
    <div className="flex flex-col gap-1" aria-label="연결된 자료">
      <span className="text-[11px] font-medium text-muted px-1">연결된 자료</span>
      {sources.length === 0 && <span className="px-1 text-xs text-muted">연결된 자료가 없습니다</span>}
      {sources.map((source) => (
        <div key={source.id} className="group relative">
          <a href={sourceUrl(source)} target="_blank" rel="noopener" className={`flex items-center gap-1.5 rounded-lg hover:bg-ground/70 ${row}`}>
            <span aria-label={source.kind === "sheet" ? "시트" : "문서"} className="text-muted shrink-0">
              {source.kind === "sheet" ? "▦" : "▤"}
            </span>
            <span className="truncate">{source.title}</span>
          </a>
          <button
            type="button"
            aria-label={`${source.title} 연결 해제`}
            onClick={() => void unlink(source)}
            disabled={unlinking === source.id}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600 disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ))}
      <button type="button" onClick={onAddSource} className={`text-left rounded-lg text-xs text-muted hover:bg-ground hover:text-ink ${size === "md" ? "px-2.5 py-2" : "px-1.5 py-1"}`}>
        + 자료 추가
      </button>
    </div>
  );
}
