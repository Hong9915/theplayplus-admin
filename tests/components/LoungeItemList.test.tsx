// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoungeItemList from "@/components/lounge/LoungeItemList";
import type { LoungeItemRow } from "@/lib/lounge-items";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const item = (over: Partial<LoungeItemRow> = {}): LoungeItemRow => ({
  id: "i1", gameId: "g1", kind: "post", naverId: 100, feedId: 100, title: "질문 있어요", body: "본문", boardName: "자유", nickname: "유저1",
  isUser: true, url: "https://game.naver.com/lounge/L1/board/detail/100", postedAt: "2026-09-21T09:57:00.000Z", readAt: null, ...over,
});

describe("LoungeItemList", () => {
  beforeEach(() => {
    refresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("links each item to the lounge post in a new tab and marks it read on click", async () => {
    render(<LoungeItemList gameId="g1" items={[item(), item({ id: "i2", kind: "comment", naverId: 500, body: "댓글", readAt: "2026-09-21T10:00:00.000Z" })]} />);
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "https://game.naver.com/lounge/L1/board/detail/100");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(within(links[0]).getByText("새 글")).toBeInTheDocument();
    expect(within(links[1]).getByText("댓글", { selector: "[data-kind]" })).toBeInTheDocument();
    expect(within(links[0]).getByText("안 읽음")).toBeInTheDocument();

    links[0].addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(links[0]);
    expect(global.fetch).toHaveBeenCalledWith("/api/lounge/items/i1/read", { method: "POST" });
    expect(within(links[0]).queryByText("안 읽음")).not.toBeInTheDocument();
  });

  it("does not call the api for an item that is already read", async () => {
    render(<LoungeItemList gameId="g1" items={[item({ readAt: "2026-09-21T10:00:00.000Z" })]} />);
    const link = screen.getByRole("link");
    link.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(link);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("marks everything read", async () => {
    render(<LoungeItemList gameId="g1" items={[item()]} />);
    await userEvent.click(screen.getByRole("button", { name: "모두 읽음" }));
    expect(global.fetch).toHaveBeenCalledWith("/api/games/g1/lounge/read-all", { method: "POST" });
    expect(screen.queryByText("안 읽음")).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an empty state", () => {
    render(<LoungeItemList gameId="g1" items={[]} />);
    expect(screen.getByText(/아직 가져온 글이 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "모두 읽음" })).not.toBeInTheDocument();
  });
});
