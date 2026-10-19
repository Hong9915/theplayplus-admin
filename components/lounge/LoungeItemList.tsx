"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LoungeItemRow } from "@/lib/lounge-items";
import StatusMessage from "@/components/ui/StatusMessage";

const dateFormat = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });

const READ_ERROR = "읽음 처리에 실패했습니다. 다시 시도해주세요.";

/** 미리보기용. 줄바꿈과 공백을 하나로 모은다(빈 줄·말줄임만 남은 줄이 한 줄을 차지하지 않게). */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

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
    return (
      <p className="py-16 text-center text-[14px] text-muted">
        아직 가져온 글이 없습니다. 라운지를 연결하면 5분 안에 첫 동기화가 돌고, 그 뒤에 올라오는 유저 글·댓글부터 알려드립니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 min-h-[34px]">
        <p className="text-[13.5px] font-semibold text-ink-2">
          {unreadCount > 0 ? (
            <>
              안 읽음 <span className="text-accent tabular-nums">{unreadCount}</span>건
            </>
          ) : (
            "모두 읽었습니다"
          )}
          <span className="ml-2 font-normal text-muted">최근 {items.length}건</span>
        </p>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="h-[34px] px-3 rounded-[9px] text-[13.5px] font-semibold text-ink-2 ring-1 ring-inset ring-line bg-panel hover:text-ink hover:bg-well active:bg-line-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            모두 읽음
          </button>
        )}
      </div>
      <StatusMessage className="text-sm">{error}</StatusMessage>
      <ul className="flex flex-col gap-0.5 p-1.5 rounded-2xl bg-panel shadow-paper">
        {items.map((item) => {
          const unread = !readIds.has(item.id);
          const comment = item.kind === "comment";
          // 댓글은 댓글 내용이 본문이고 원글 제목은 맥락이다. 글은 제목이 본문이고 내용은 미리보기다.
          const preview = oneLine(item.body);
          const headline = comment && preview ? preview : item.title;
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
                className="relative flex flex-col gap-1 pl-8 pr-4 py-3 rounded-xl hover:bg-well active:bg-line-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                {/* 안 읽음은 Mail처럼 행 앞의 점으로. 글자는 보조기기용. */}
                {unread && (
                  <span className="absolute left-3 top-[19px] w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
                )}
                <span className="flex items-center gap-2 text-[12.5px] text-muted min-w-0">
                  <span
                    data-kind={item.kind}
                    className={`inline-flex items-center h-[22px] px-2 rounded-md text-xs font-semibold shrink-0 ${
                      comment ? "bg-line-soft text-ink-2" : "bg-[#03C75A]/10 text-[#027A37]"
                    }`}
                  >
                    {comment ? "댓글" : "새 글"}
                  </span>
                  {item.boardName && <span className="truncate">{item.boardName}</span>}
                  <span className={`truncate ${item.isUser ? "text-ink-2 font-medium" : ""}`}>{item.nickname ?? "알 수 없음"}</span>
                  {!item.isUser && (
                    <span className="inline-flex items-center h-5 px-1.5 rounded text-[11.5px] font-semibold ring-1 ring-inset ring-line text-muted shrink-0">운영자</span>
                  )}
                  <time dateTime={item.postedAt} className="ml-auto shrink-0 tabular-nums">
                    {dateFormat.format(new Date(item.postedAt))}
                  </time>
                  {unread && <span className="sr-only">안 읽음</span>}
                </span>
                <span className={`text-[14.5px] leading-snug tracking-[-.01em] line-clamp-2 ${unread ? "font-semibold text-ink" : "text-ink"}`}>{headline}</span>
                {comment ? (
                  <span className="flex items-center gap-1.5 text-[13px] text-muted min-w-0">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
                      <path d="M9 14 4 9l5-5" />
                      <path d="M4 9h10a6 6 0 0 1 6 6v5" />
                    </svg>
                    <span className="truncate">{item.title}</span>
                  </span>
                ) : (
                  preview && <span className="text-[13px] text-muted line-clamp-2">{preview}</span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
