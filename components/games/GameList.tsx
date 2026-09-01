import Link from "next/link";
import type { GameRow } from "@/lib/categories";

export default function GameList({ games }: { games: GameRow[] }) {
  if (games.length === 0) {
    return <p>등록된 게임이 없습니다.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {games.map((game) => (
        <li key={game.id} className="border border-white/10 rounded p-4">
          <Link href={`/games/${game.id}/inquiries`} className="flex items-center justify-between">
            <span className="font-medium">{game.name}</span>
            <span className="text-sm text-white/60">{game.status === "active" ? "서비스중" : "종료"}</span>
          </Link>
          {game.ownerName && <p className="text-sm text-white/60 mt-1">담당자: {game.ownerName}</p>}
        </li>
      ))}
    </ul>
  );
}
