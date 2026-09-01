"use client";

import { useRouter } from "next/navigation";
import GameForm from "@/components/games/GameForm";
import GameList from "@/components/games/GameList";
import type { GameRow } from "@/lib/categories";

export default function GamesPageClient({ games }: { games: GameRow[] }) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">게임 추가</h2>
        <GameForm onCreated={() => router.refresh()} />
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">게임 목록</h2>
        <GameList games={games} />
      </section>
    </div>
  );
}
