// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AssistantShell from "@/components/assistant/AssistantShell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));

const game = { id: "g1", name: "여신 키우기" };

const sources = [{ id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "1AbC", title: "VIP 원장", createdAt: "" }];

const conversations = [
  { id: "c3", gameId: "g1", title: "VIP 확인", createdBy: "a@b", createdAt: "", updatedAt: "" },
];

describe("AssistantShell", () => {
  beforeEach(() => {
    global.fetch = vi.fn() as never;
  });

  it("loads the clicked conversation's messages when switching from a fresh new-chat pane", () => {
    const { rerender } = render(
      <AssistantShell game={game} sources={sources} conversations={conversations} selectedId={null} messages={[]} serviceAccountEmail={null} />
    );

    // 서버 렌더가 서로 다른 selectedId·messages로 다시 그린 것을 흉내낸다 — 사이드바에서
    // 다른(이미 존재하는) 대화를 고른 경우다. 페인이 리마운트돼야 그 대화의 initialMessages가
    // 반영된다.
    rerender(
      <AssistantShell
        game={game}
        sources={sources}
        conversations={conversations}
        selectedId="c3"
        messages={[{ id: "m1", role: "assistant", content: "c3의 답변", proposal: null, status: null, failureReason: null, appliedBy: null, appliedAt: null, attachments: [] }]}
        serviceAccountEmail={null}
      />
    );

    expect(screen.getByText("c3의 답변")).toBeInTheDocument();
  });

  it("marks the selected conversation as current in the sidebar", () => {
    render(
      <AssistantShell game={game} sources={sources} conversations={conversations} selectedId="c3" messages={[]} serviceAccountEmail={null} />
    );

    expect(screen.getByRole("link", { name: "VIP 확인" })).toHaveAttribute("aria-current", "true");
  });

  it("asks to add a source when none is linked", () => {
    render(<AssistantShell game={game} sources={[]} conversations={[]} selectedId={null} messages={[]} serviceAccountEmail={null} />);
    expect(screen.getByText("이 게임에 연결된 자료가 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "자료 추가하기" })).toBeInTheDocument();
    expect(screen.queryByLabelText("메시지")).toBeNull();
  });
});
