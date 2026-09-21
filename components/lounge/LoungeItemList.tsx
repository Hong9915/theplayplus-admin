"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LoungeItemRow } from "@/lib/lounge-items";
import StatusMessage from "@/components/ui/StatusMessage";

const dateFormat = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });

const READ_ERROR = "읽음 처리에 실패했습니다. 다시 시도해주세요.";

/** 응답이 ok이고 {success:true}일 때만 성공으로 본다. */
async function postRead(url: string): Promise<boolean> {
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) return false;
  const data = await response.json().catch(() => null);
  return data?.success === true;
}

/**
 * 네이버 라운지에서 가져온 글·댓글 목록. 항목은 라운지의 그 글을 새 탭으로 여는 링크이고,
 * 누르는 순간 읽음으로 바꾼다(이동은 결과와 상관없이 그대로 진행). 저장이 실패하면 읽음
 * 표시를 되돌려 다시 시도할 수 있게 하고 경고를 보여준다.
 */
export default function LoungeItemList({ gameId, items }: { gameId: string; items: LoungeItemRow[] }) {
  const router = useRouter();
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set(items.filter((item) => item.readAt).map((item) => item.id)));
  const [error, setError] = useState<string | null>(null);
  const unreadCount = items.filter((item) => !readIds.has(item.id)).length;

  async function markRead(id: string) {
    if (readIds.has(id)) return;
    setReadIds((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const ok = await postRead(`/api/lounge/items/${id}/read`);
      if (!ok) throw new Error("save_failed");
      router.refresh();
    } catch {
      setReadIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setError(READ_ERROR);
    }
  }

  async function markAllRead() {
    const addedIds = items.filter((item) => !readIds.has(item.id)).map((item) => item.id);
    setReadIds((prev) => {
      const next = new Set(prev);
      addedIds.forEach((id) => next.add(id));
      return next;
    });
    setError(null);
    try {
      const ok = await postRead(`/api/games/${gameId}/lounge/read-all`);
      if (!ok) throw new Error("save_failed");
      router.refresh();
    } catch {
      setReadIds((prev) => {
        const next = new Set(prev);
        addedIds.forEach((id) => next.delete(id));
        return next;
      });
      setError(READ_ERROR);
    }
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted">아직 가져온 글이 없습니다. 라운지를 연결하면 5분 안에 첫 동기화가 돌고, 그 뒤에 올라오는 유저 글·댓글부터 알려드립니다.</p>;
  }

  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">안 읽음 {unreadCount}건</p>
        {unreadCount > 0 && (
          <button type="button" onClick={markAllRead} className="text-sm rounded-lg border border-line px-3 py-1.5 hover:bg-ground transition-colors">
            모두 읽음
          </button>
        )}
      </div>
      <StatusMessage className="text-sm">{error}</StatusMessage>
      <ul className="flex flex-col border border-line rounded-xl bg-panel divide-y divide-line overflow-hidden">
        {items.map((item) => {
          const unread = !readIds.has(item.id);
          return (
            <li key={item.id}>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => markRead(item.id)}
                // 가운데 버튼(새 탭)만. 오른쪽 버튼도 auxclick을 내는데, 메뉴만 열고 읽지 않았을 수 있다.
                onAuxClick={(event) => {
                  if (event.button === 1) markRead(item.id);
                }}
                className={`flex flex-col gap-1 px-4 py-3 hover:bg-ground transition-colors ${item.isUser ? "" : "opacity-60"}`}
              >
                <span className="flex items-center gap-2 text-xs text-muted">
                  <span data-kind={item.kind} className={`rounded px-1.5 py-0.5 font-medium ${item.kind === "post" ? "bg-emerald-100 text-emerald-700" : "bg-ground text-muted"}`}>
                    {item.kind === "post" ? "새 글" : "댓글"}
                  </span>
                  {item.boardName && <span>{item.boardName}</span>}
                  <span>{item.nickname ?? "알 수 없음"}{item.isUser ? "" : " · 운영자"}</span>
                  <time dateTime={item.postedAt}>{dateFormat.format(new Date(item.postedAt))}</time>
                  {unread && <span className="ml-auto rounded-full bg-accent/10 text-accent px-2 py-0.5 font-semibold">안 읽음</span>}
                </span>
                <span className={`text-sm truncate ${unread ? "font-semibold text-ink" : "text-ink"}`}>{item.title}</span>
                {item.body && <span className="text-[13px] text-muted line-clamp-2 whitespace-pre-line">{item.body}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
