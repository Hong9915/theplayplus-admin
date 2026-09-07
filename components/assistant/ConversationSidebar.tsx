"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConversationRow } from "@/lib/assistant-store";
import { sourceUrl, type SourceRow } from "@/lib/source-url";

export default function ConversationSidebar({
  gameId,
  gameName,
  conversations,
  selectedId,
  sources,
  onAddSource,
}: {
  gameId: string;
  gameName: string;
  conversations: ConversationRow[];
  selectedId: string | null;
  sources: SourceRow[];
  onAddSource: () => void;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const base = `/games/${gameId}/assistant`;

  async function remove(conversation: ConversationRow) {
    setDeleting(conversation.id);
    try {
      await fetch(`/api/assistant/conversations/${conversation.id}`, { method: "DELETE" });
    } finally {
      setDeleting(null);
    }
    if (conversation.id === selectedId) {
      router.push(base);
    } else {
      router.refresh();
    }
  }

  async function unlink(source: SourceRow) {
    setUnlinking(source.id);
    try {
      await fetch(`/api/games/${gameId}/sources/${source.id}`, { method: "DELETE" });
    } finally {
      setUnlinking(null);
    }
    router.refresh();
  }

  return (
    <aside className="w-[260px] shrink-0 h-full bg-panel border-r border-line flex flex-col" aria-label="대화 목록">
      <div className="px-4 pt-4 pb-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold truncate">{gameName}</h1>
          <span className="text-[11px] text-muted shrink-0">운영 어시스턴트</span>
        </div>

        <div className="flex flex-col gap-1" aria-label="연결된 자료">
          <span className="text-[11px] font-medium text-muted px-1">연결된 자료</span>
          {sources.length === 0 && <span className="px-1 text-xs text-muted">연결된 자료가 없습니다</span>}
          {sources.map((source) => (
            <div key={source.id} className="group relative">
              <a
                href={sourceUrl(source)}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 pr-7 text-sm hover:bg-ground/70"
              >
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
          <button type="button" onClick={onAddSource} className="text-left rounded-lg px-1.5 py-1 text-xs text-muted hover:bg-ground hover:text-ink">
            + 자료 추가
          </button>
        </div>

        <Link href={base} className="inline-flex items-center justify-center gap-1 rounded-lg border border-line px-3 py-2 text-sm hover:bg-ground">
          + 새 대화
        </Link>
      </div>

      <ul className="flex-1 overflow-y-auto px-2 flex flex-col gap-0.5">
        {conversations.length === 0 && <li className="px-2.5 py-2 text-xs text-muted">아직 대화가 없습니다.</li>}
        {conversations.map((conversation) => {
          const active = conversation.id === selectedId;
          return (
            <li key={conversation.id} className="group relative">
              <Link
                href={`${base}?c=${conversation.id}`}
                aria-current={active ? "true" : undefined}
                className={`block rounded-lg px-2.5 py-2 pr-8 text-sm truncate ${active ? "bg-ground font-medium" : "hover:bg-ground/70"}`}
              >
                {conversation.title}
              </Link>
              <button
                type="button"
                aria-label={`${conversation.title} 삭제`}
                onClick={() => void remove(conversation)}
                disabled={deleting === conversation.id}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600 disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
