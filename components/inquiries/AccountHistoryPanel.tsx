import type { AccountHistoryEntry } from "@/lib/account-history";

const STATUS_LABEL: Record<AccountHistoryEntry["status"], string> = {
  new: "접수",
  in_progress: "처리중",
  resolved: "완료",
};

export default function AccountHistoryPanel({
  history,
  gameAccount,
}: {
  history: AccountHistoryEntry[];
  gameAccount: string | null;
}) {
  return (
    <aside className="border border-white/10 rounded p-4 flex flex-col gap-4">
      <div>
        <h2 className="font-semibold mb-2">계정 이력</h2>
        {!gameAccount ? (
          <p className="text-sm text-white/60">게임 계정 정보가 없어 이력을 조회할 수 없습니다.</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-white/60">이전 문의 이력이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((entry) => (
              <li key={entry.id} className="text-sm">
                <span>{entry.title}</span>
                <span className="text-white/60"> · {STATUS_LABEL[entry.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        {/* Extension point: once an event_participants table exists, join it
            here on game_id + game_account, the same matching rule as above. */}
        <h2 className="font-semibold mb-2">이벤트 참여 이력 (준비 중)</h2>
        <p className="text-sm text-white/60">아직 연동된 이벤트 데이터가 없습니다.</p>
      </div>
    </aside>
  );
}
