// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoungeConnectDialog from "@/components/inbox/LoungeConnectDialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("LoungeConnectDialog", () => {
  beforeEach(() => refresh.mockReset());

  it("opens, saves the url, and refreshes", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true, loungeId: "Abc" }) }) as never;
    render(<LoungeConnectDialog gameId="g1" loungeId={null} />);
    await userEvent.click(screen.getByRole("button", { name: "네이버 라운지 연결" }));
    await userEvent.type(screen.getByLabelText("라운지 주소"), "https://game.naver.com/lounge/Abc/home");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(global.fetch).toHaveBeenCalledWith("/api/games/g1/lounge", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ loungeUrl: "https://game.naver.com/lounge/Abc/home" }) }));
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows why the lounge was rejected and stays open", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false, error: "lounge_unreachable" }) }) as never;
    render(<LoungeConnectDialog gameId="g1" loungeId="Old" />);
    await userEvent.click(screen.getByRole("button", { name: "네이버 라운지 변경" }));
    expect(screen.getByLabelText("라운지 주소")).toHaveValue("https://game.naver.com/lounge/Old/home");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText(/라운지를 읽을 수 없습니다/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
