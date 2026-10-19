// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GameSettingsDrawer from "@/components/games/GameSettingsDrawer";
import type { GameRow } from "@/lib/categories";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

const game: GameRow = { id: "g1", name: "아르카나 사가", status: "active", logoPath: null, ownerName: null, createdAt: "2026-01-01T00:00:00.000Z" };

describe("GameSettingsDrawer", () => {
  it("opens as a drawer and closes along the same path on Escape", async () => {
    render(<GameSettingsDrawer game={game} inquiryCount={3} />);
    await userEvent.click(screen.getByRole("button", { name: "게임 설정" }));
    const drawer = screen.getByRole("dialog", { name: "아르카나 사가 설정" });
    expect(drawer.className).toMatch(/animate-drawer-in/);

    await userEvent.keyboard("{Escape}");
    expect(drawer.className).toMatch(/animate-drawer-out/);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "게임 설정" })).toHaveFocus();
  });

  it("names the lounge row by what it does next", async () => {
    render(<GameSettingsDrawer game={{ ...game, naverLoungeId: "Abc" }} inquiryCount={3} />);
    await userEvent.click(screen.getByRole("button", { name: "게임 설정" }));
    expect(screen.getByRole("button", { name: "네이버 라운지 변경" })).toBeInTheDocument();
  });

  it("asks before deleting, and Escape closes only the confirmation", async () => {
    render(<GameSettingsDrawer game={game} inquiryCount={3} />);
    await userEvent.click(screen.getByRole("button", { name: "게임 설정" }));
    await userEvent.click(screen.getByRole("button", { name: "게임 삭제…" }));
    const confirm = screen.getByRole("dialog", { name: "게임 삭제" });
    expect(within(confirm).getByText("3건")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "게임 삭제" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "아르카나 사가 설정" })).toBeInTheDocument();
  });
});
