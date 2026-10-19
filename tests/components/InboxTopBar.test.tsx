// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InboxTopBar from "@/components/inbox/InboxTopBar";
import { DEFAULT_QUERY } from "@/lib/inquiry-filters";
import type { InquiryFacetCounts } from "@/lib/inquiries";
import type { GameRow } from "@/lib/categories";
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

const game: GameRow = { id: "g1", name: "아르카나 사가", status: "active", logoPath: null, ownerName: null, createdAt: "2026-01-01T00:00:00.000Z" };

const counts: InquiryFacetCounts = {
  total: 23,
  status: { new: 4, in_progress: 7, resolved: 12 },
  type: {},
  priority: { urgent: 1, high: 3, normal: 10, low: 9 },
  stale: 2,
  unread: 3,
};

function renderBar(g: GameRow | null = game, loungeUnread: number | null = null) {
  return render(
    <InboxTopBar scope={g ? gameScope(g.id) : SERVICE_SCOPE} title={g ? g.name : "서비스 문의"} game={g} query={DEFAULT_QUERY} counts={counts} selectedId={null} loungeUnread={loungeUnread} />
  );
}

describe("InboxTopBar", () => {
  it("shows the game, its status, and the total", () => {
    renderBar();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("아르카나 사가");
    expect(screen.getByText("서비스중")).toBeInTheDocument();
    expect(screen.getByText("문의함 · 전체 23건")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "검색" })).toBeInTheDocument();
  });

  it("links to the lounge list with the unread count when a lounge is connected", () => {
    renderBar({ ...game, naverLoungeId: "Abc" }, 4);
    const link = screen.getByRole("link", { name: /라운지 새 글/ });
    expect(link).toHaveAttribute("href", "/games/g1/lounge");
    expect(within(link).getByText("4")).toBeInTheDocument();
  });

  it("has no lounge link when none is connected", () => {
    renderBar();
    expect(screen.queryByRole("link", { name: /라운지 새 글/ })).not.toBeInTheDocument();
  });

  it("links to the operations sources page in a new tab while the assistant chat is off", () => {
    renderBar();
    const link = screen.getByRole("link", { name: /운영 자료/ });
    expect(link).toHaveAttribute("href", "/games/g1/assistant");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    expect(screen.queryByRole("link", { name: /운영 어시스턴트/ })).not.toBeInTheDocument();
  });

  it("calls the link the operations assistant when the chat flag is on", () => {
    process.env.ASSISTANT_CHAT_ENABLED = "1";
    try {
      renderBar();
      expect(screen.getByRole("link", { name: /운영 어시스턴트/ })).toHaveAttribute("href", "/games/g1/assistant");
    } finally {
      delete process.env.ASSISTANT_CHAT_ENABLED;
    }
  });

  it("keeps templates, the site page, the lounge connection, and deletion behind 게임 설정", async () => {
    renderBar();
    expect(screen.queryByRole("link", { name: /답변 템플릿/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "게임 설정" }));
    const drawer = screen.getByRole("dialog", { name: "아르카나 사가 설정" });
    expect(within(drawer).getByRole("link", { name: /답변 템플릿/ })).toHaveAttribute("href", "/games/g1/templates");
    expect(within(drawer).getByRole("link", { name: /웹사이트 게임 페이지/ })).toHaveAttribute("href", "/games/g1/site");
    expect(within(drawer).getByRole("button", { name: "네이버 라운지 연결" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "게임 삭제…" })).toBeInTheDocument();
  });

  describe("service scope", () => {
    it("shows the service title without a game status, tools, or settings", () => {
      renderBar(null);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("서비스 문의");
      expect(screen.queryByText("서비스중")).not.toBeInTheDocument();
      expect(screen.queryByText("종료")).not.toBeInTheDocument();
      expect(screen.getByText("문의함 · 전체 23건")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /운영 자료|운영 어시스턴트/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "게임 설정" })).not.toBeInTheDocument();
    });
  });
});
