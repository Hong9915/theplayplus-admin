// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GameForm from "@/components/games/GameForm";

describe("GameForm", () => {
  const createdGame = {
    id: "game-1",
    name: "여신키우기",
    status: "active" as const,
    logoPath: null,
    ownerName: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, game: createdGame }),
    }) as never;
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
    expect(onCreated).toHaveBeenCalledWith(createdGame);
  });

  it("shows a rollback message when logo upload fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: false, error: "logo_upload_failed" }),
    }) as never;
    const onCreated = vi.fn();
    render(<GameForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText("게임명"), "여신키우기");
    await userEvent.click(screen.getByRole("button", { name: "게임 추가" }));

    expect(await screen.findByText("로고 업로드에 실패해 게임이 추가되지 않았습니다. 다시 시도해주세요.")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("shows a failure message and re-enables the button when the request throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as never;
    render(<GameForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("게임명"), "여신키우기");
    const button = screen.getByRole("button", { name: "게임 추가" });
    await userEvent.click(button);

    expect(await screen.findByText("게임 추가에 실패했습니다. 다시 시도해주세요.")).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });
});
