// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GameRail from "@/components/layout/GameRail";
import type { GameRow } from "@/lib/categories";

let pathname = "/games/g1/inquiries";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// next/image는 jsdom에서 로더 설정을 요구한다. 레일 테스트에는 img면 충분하다.
// unoptimized는 img가 모르는 prop이라 떼어낸다.
vi.mock("next/image", () => ({
  default: ({ unoptimized: _unoptimized, ...props }: { unoptimized?: boolean; src: string; alt: string }) => <img {...props} />,
}));
vi.mock("@/components/games/GameForm", () => ({ default: () => <div data-testid="game-form" /> }));
vi.mock("@/lib/supabase-browser", () => ({ getSupabaseBrowserClient: () => ({ auth: { signOut: vi.fn() } }) }));

const games: GameRow[] = [
  { id: "g1", name: "아르카나 사가", status: "active", logoPath: null, ownerName: null, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "g2", name: "여신의 검", status: "ended", logoPath: null, ownerName: null, createdAt: "2026-01-02T00:00:00.000Z" },
];

describe("GameRail", () => {
  beforeEach(() => {
    pathname = "/games/g1/inquiries";
  });

  it("puts the service inquiry tile before every game and links it to /service/inquiries", () => {
    render(<GameRail games={games} newCounts={{ g1: 2 }} />);
    const nav = screen.getByRole("navigation", { name: "게임 목록" });
    const links = within(nav).getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/service/inquiries");
    expect(links[0]).toHaveAttribute("title", "서비스 문의 (제휴·기타)");
    expect(links[1]).toHaveAttribute("href", "/games/g1/inquiries");
    expect(links[2]).toHaveAttribute("href", "/games/g2/inquiries");
  });

  it("shows the new-inquiry badge on the service tile from newCounts.service", () => {
    render(<GameRail games={games} newCounts={{ service: 3, g1: 2 }} />);
    const service = screen.getByRole("link", { name: /서비스 문의/ });
    expect(within(service).getByText("접수 3건")).toBeInTheDocument();
    expect(within(service).getByText("3")).toHaveAttribute("aria-hidden", "true");
    expect(service).toHaveAttribute("title", "서비스 문의 (제휴·기타) · 접수 3건");
  });

  it("has no badge when nothing is new for the service inbox", () => {
    render(<GameRail games={games} newCounts={{ g1: 2 }} />);
    const service = screen.getByRole("link", { name: /서비스 문의/ });
    expect(within(service).queryByText(/접수/)).not.toBeInTheDocument();
  });

  // 로고 없는 게임 타일의 접근성 이름은 첫 글자("아")뿐이라 title로 찾는다.
  it("marks the service tile current under /service/ and the game tile under /games/{id}/", () => {
    pathname = "/service/inquiries/i1?status=new";
    const { unmount } = render(<GameRail games={games} />);
    expect(screen.getByRole("link", { name: /서비스 문의/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTitle("아르카나 사가")).not.toHaveAttribute("aria-current");
    unmount();

    pathname = "/games/g2/inquiries";
    render(<GameRail games={games} />);
    expect(screen.getByRole("link", { name: /서비스 문의/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByTitle("여신의 검")).toHaveAttribute("aria-current", "page");
  });
  it("names the add-game button for assistive tech", () => {
    render(<GameRail games={games} />);
    expect(screen.getByRole("button", { name: "게임 추가" })).toBeInTheDocument();
  });

  describe("add-game dialog", () => {
    it("opens a labelled dialog, closes on Escape, and returns focus to the opener", async () => {
      render(<GameRail games={games} />);
      const opener = screen.getByRole("button", { name: "게임 추가" });
      await userEvent.click(opener);
      const dialog = screen.getByRole("dialog", { name: "게임 추가" });
      expect(dialog).toBeInTheDocument();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);

      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });

    it("closes from the × button", async () => {
      render(<GameRail games={games} />);
      await userEvent.click(screen.getByRole("button", { name: "게임 추가" }));
      await userEvent.click(screen.getByRole("button", { name: "닫기" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
