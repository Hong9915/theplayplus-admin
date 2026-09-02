import Link from "next/link";
import type { AccountHistoryEntry } from "@/lib/account-history";
import { formatReceivedAt } from "@/lib/format";
import StatusBadge from "@/components/ui/StatusBadge";

export default function AccountHistoryPanel({
  history,
  gameAccount,
}: {
  history: AccountHistoryEntry[];
  gameAccount: string | null;
}) {
  return (
    <aside className="border border-line rounded-xl p-4 bg-panel flex flex-col gap-4">
      <div>
        <h2 className="font-semibold mb-2">계정 이력</h2>
        {!gameAccount ? (
          <p className="text-sm text-muted">게임 계정 정보가 없어 이력을 조회할 수 없습니다.</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">이전 문의 이력이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((entry) => (
              <li key={entry.id}>
                {/* 항목 전체가 링크다. 제목만 링크로 두면 본문 미리보기를 눌렀을 때
                    아무 일도 없어 답답하다. */}
                <Link
                  href={`/inquiries/${entry.id}`}
                  className="block rounded-lg border border-line bg-ground/60 px-3 py-2 hover:border-accent hover:bg-ground transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{entry.title}</span>
                    <StatusBadge status={entry.status} />
                  </div>
                  {entry.content && (
                    <p className="mt-1 text-xs text-muted line-clamp-2 whitespace-pre-line break-words">
                      {entry.content}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] font-mono text-muted">{formatReceivedAt(entry.createdAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        {/* Extension point: once an event_participants table exists, join it
            here on game_id + game_account, the same matching rule as above. */}
        <h2 className="font-semibold mb-2">이벤트 참여 이력 (준비 중)</h2>
        <p className="text-sm text-muted">아직 연동된 이벤트 데이터가 없습니다.</p>
      </div>
    </aside>
  );
}
