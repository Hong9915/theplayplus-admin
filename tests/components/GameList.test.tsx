// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GameList from "@/components/games/GameList";
import type { GameRow } from "@/lib/categories";

describe("GameList", () => {
  const games: GameRow[] = [
    { id: "game-1", name: "여신키우기", status: "active", logoPath: null, ownerName: "홍길동", createdAt: "2026-01-01" },
    { id: "game-2", name: "종료된 게임", status: "ended", logoPath: null, ownerName: null, createdAt: "2025-01-01" },
  ];

  it("renders a link per game showing name and status", () => {
    render(<GameList games={games} />);
    expect(screen.getByText("여신키우기")).toBeInTheDocument();
    expect(screen.getByText("서비스중")).toBeInTheDocument();
    expect(screen.getByText("종료된 게임")).toBeInTheDocument();
    expect(screen.getByText("종료")).toBeInTheDocument();
  });

  it("shows an empty state when there are no games", () => {
    render(<GameList games={[]} />);
    expect(screen.getByText("등록된 게임이 없습니다.")).toBeInTheDocument();
  });
});
