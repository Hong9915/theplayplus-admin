// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConversationSidebar from "@/components/assistant/ConversationSidebar";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

const conversations = [
  { id: "c1", gameId: "g1", title: "VIP 확인", createdBy: "a@b", createdAt: "", updatedAt: "" },
  { id: "c2", gameId: "g1", title: "보상 코드", createdBy: "a@b", createdAt: "", updatedAt: "" },
];

describe("ConversationSidebar", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("lists conversations linking to ?c= and marks the selected one", () => {
    render(<ConversationSidebar gameId="g1" gameName="여신 키우기" conversations={conversations} selectedId="c2" onOpenSettings={vi.fn()} />);
    expect(screen.getByText("여신 키우기")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "VIP 확인" })).toHaveAttribute("href", "/games/g1/assistant?c=c1");
    expect(screen.getByRole("link", { name: "보상 코드" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /새 대화/ })).toHaveAttribute("href", "/games/g1/assistant");
  });

  it("deletes a conversation and navigates away when it was selected", async () => {
    render(<ConversationSidebar gameId="g1" gameName="G" conversations={conversations} selectedId="c1" onOpenSettings={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "VIP 확인 삭제" }));
    expect(global.fetch).toHaveBeenCalledWith("/api/assistant/conversations/c1", { method: "DELETE" });
    expect(push).toHaveBeenCalledWith("/games/g1/assistant");
  });

  it("opens settings", async () => {
    const onOpenSettings = vi.fn();
    render(<ConversationSidebar gameId="g1" gameName="G" conversations={[]} selectedId={null} onOpenSettings={onOpenSettings} />);
    await userEvent.click(screen.getByRole("button", { name: /시트 설정/ }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
