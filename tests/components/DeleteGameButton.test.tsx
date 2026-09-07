// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeleteGameButton from "@/components/games/DeleteGameButton";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

describe("DeleteGameButton", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("opens a confirm dialog showing the inquiry count", async () => {
    render(<DeleteGameButton gameId="game-1" gameName="여신 키우기" inquiryCount={5} />);

    await userEvent.click(screen.getByRole("button", { name: "게임 삭제" }));

    expect(screen.getByRole("dialog", { name: "게임 삭제" })).toBeInTheDocument();
    expect(screen.getByText("5건")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("cancel closes the dialog without deleting", async () => {
    render(<DeleteGameButton gameId="game-1" gameName="여신 키우기" inquiryCount={0} />);

    await userEvent.click(screen.getByRole("button", { name: "게임 삭제" }));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("confirming calls the delete API and navigates home", async () => {
    render(<DeleteGameButton gameId="game-1" gameName="여신 키우기" inquiryCount={0} />);

    await userEvent.click(screen.getByRole("button", { name: "게임 삭제" }));
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/games/game-1", { method: "DELETE" });
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an error and stays open when the API fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<DeleteGameButton gameId="game-1" gameName="여신 키우기" inquiryCount={0} />);

    await userEvent.click(screen.getByRole("button", { name: "게임 삭제" }));
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));

    expect(await screen.findByText("삭제에 실패했습니다. 다시 시도해주세요.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "게임 삭제" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
  it("focuses 취소 first, closes on Escape, and returns focus to the opener", async () => {
    render(<DeleteGameButton gameId="game-1" gameName="여신 키우기" inquiryCount={0} />);
    const opener = screen.getByRole("button", { name: "게임 삭제" });

    await userEvent.click(opener);
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("announces the failure through a live region", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<DeleteGameButton gameId="game-1" gameName="여신 키우기" inquiryCount={0} />);

    await userEvent.click(screen.getByRole("button", { name: "게임 삭제" }));
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));

    expect(await screen.findByRole("status")).toHaveTextContent("삭제에 실패했습니다. 다시 시도해주세요.");
  });
});
