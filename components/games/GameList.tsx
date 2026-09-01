import Link from "next/link";
import type { GameRow } from "@/lib/categories";

export default function GameList({ games }: { games: GameRow[] }) {
  if (games.length === 0) {
    return (
      <p className="text-white/50 text-sm border border-dashed border-white/15 rounded-lg p-6 text-center">
        등록된 게임이 없습니다.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {games.map((game) => (
        <li
          key={game.id}
          className="border border-white/10 rounded-lg p-4 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
        >
          <Link href={`/games/${game.id}/inquiries`} className="flex items-center justify-between">
            <span className="font-medium">{game.name}</span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                game.status === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-white/10 text-white/60"
              }`}
            >
              {game.status === "active" ? "서비스중" : "종료"}
            </span>
          </Link>
          {game.ownerName && <p className="text-sm text-white/60 mt-1">담당자: {game.ownerName}</p>}
        </li>
      ))}
    </ul>
  );
}
