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

  it("keeps the created game and warns when only the logo upload failed", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, game: createdGame, warning: "logo_upload_failed" }),
    }) as never;
    const onCreated = vi.fn();
    render(<GameForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText("게임명"), "여신키우기");
    await userEvent.click(screen.getByRole("button", { name: "게임 추가" }));

    expect(
      await screen.findByText("게임은 추가되었지만 로고 업로드에 실패했습니다. 로고는 나중에 다시 등록해주세요.")
    ).toBeInTheDocument();
    // The game really exists, so the caller still has to refresh its list.
    expect(onCreated).toHaveBeenCalledWith(createdGame, "logo_upload_failed");
  });

  it("shows the picked logo filename and lets it be removed again", async () => {
    render(<GameForm onCreated={vi.fn()} />);

    const input = screen.getByLabelText("로고 이미지 파일") as HTMLInputElement;
    const file = new File(["fake image bytes"], "여신로고.png", { type: "image/png" });
    await userEvent.upload(input, file);

    expect(await screen.findByText("여신로고.png")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "로고 제거" }));

    expect(screen.queryByText("여신로고.png")).not.toBeInTheDocument();
    expect(input.files?.length ?? 0).toBe(0);
  });

  it("rejects a non-image file instead of sending it", async () => {
    render(<GameForm onCreated={vi.fn()} />);

    const input = screen.getByLabelText("로고 이미지 파일") as HTMLInputElement;
    // `accept="image/*"` already filters the picker; applyAccept:false simulates
    // the ways a user can still get a non-image in (drag & drop, "all files").
    await userEvent.upload(input, new File(["not an image"], "notes.txt", { type: "text/plain" }), {
      applyAccept: false,
    });

    expect(await screen.findByText("이미지 파일만 등록할 수 있습니다.")).toBeInTheDocument();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
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
