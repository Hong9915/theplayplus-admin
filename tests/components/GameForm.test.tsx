// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GameForm from "@/components/games/GameForm";

describe("GameForm", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, id: "game-1" }),
    }) as never;
  });

  afterEach(() => {
    cleanup();
  });

  it("requires a game name before submitting", async () => {
    render(<GameForm onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "게임 추가" }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits the form data and calls onCreated on success", async () => {
    const onCreated = vi.fn();
    render(<GameForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText("게임명"), "여신키우기");
    await userEvent.click(screen.getByRole("button", { name: "게임 추가" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/games", expect.objectContaining({ method: "POST" }));
    expect(await screen.findByText("게임이 추가되었습니다.")).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalled();
  });
});
