// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import InboxNav from "@/components/inbox/InboxNav";
import { DEFAULT_QUERY, type InquiryListQuery } from "@/lib/inquiry-filters";
import type { InquiryFacetCounts } from "@/lib/inquiries";
import type { GameRow } from "@/lib/categories";
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

const game: GameRow = { id: "g1", name: "아르카나 사가", status: "active", logoPath: null, ownerName: null, createdAt: "2026-01-01T00:00:00.000Z" };

const labels = {
  groupLabels: { game_usage: "게임 이용 문의" },
  typeLabels: { account_login: "계정/로그인", payment_refund: "결제/환불" },
  typeOrder: ["account_login", "payment_refund"],
};

const counts: InquiryFacetCounts = {
  total: 23,
  status: { new: 4, in_progress: 7, resolved: 12 },
  type: { account_login: 6, payment_refund: 8 },
  priority: { urgent: 1, high: 3, normal: 10, low: 9 },
  stale: 2,
};

function renderNav(query: InquiryListQuery = DEFAULT_QUERY, c: InquiryFacetCounts | null = counts, selectedId: string | null = null) {
  return render(<InboxNav scope={gameScope("g1")} title={game.name} game={game} query={query} labels={labels} counts={c} selectedId={selectedId} />);
}

const serviceLabels = {
  groupLabels: { business: "사업 제휴 문의", other: "기타 문의" },
  typeLabels: { publishing: "퍼블리싱 제휴", press: "언론·보도 문의" },
  typeOrder: ["publishing", "press"],
};

function renderServiceNav(query: InquiryListQuery = DEFAULT_QUERY, selectedId: string | null = null) {
  return render(<InboxNav scope={SERVICE_SCOPE} title="서비스 문의" game={null} query={query} labels={serviceLabels} counts={counts} selectedId={selectedId} />);
}

describe("InboxNav", () => {
  it("shows the game, its status, and the total", () => {
    renderNav();
    expect(screen.getByText("아르카나 사가")).toBeInTheDocument();
    expect(screen.getByText("서비스중")).toBeInTheDocument();
    expect(screen.getByText("문의함 · 전체 23건")).toBeInTheDocument();
  });

  it("links each view to a query that resets the page", () => {
    renderNav({ ...DEFAULT_QUERY, page: 3, sort: "oldest" });
    expect(screen.getByRole("link", { name: /^접수/ })).toHaveAttribute("href", "/games/g1/inquiries?status=new&sort=oldest");
    expect(screen.getByRole("link", { name: /^처리중/ })).toHaveAttribute("href", "/games/g1/inquiries?status=in_progress&sort=oldest");
    expect(screen.getByRole("link", { name: /^3일 이상 미처리/ })).toHaveAttribute("href", "/games/g1/inquiries?stale=1&sort=oldest");
  });

  it("전체 clears status, stale, priority, and type but keeps the search and sort", () => {
    renderNav({ ...DEFAULT_QUERY, status: "new", type: "account_login", priority: "high", stale: true, q: "x", sort: "priority" });
    expect(screen.getByRole("link", { name: /^전체/ })).toHaveAttribute("href", "/games/g1/inquiries?q=x&sort=priority");
  });

  it("marks the active view, type, and priority", () => {
    renderNav({ ...DEFAULT_QUERY, status: "new", type: "payment_refund", priority: "urgent" });
    expect(screen.getByRole("link", { name: /^접수/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /^전체/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /결제\/환불/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /긴급/ })).toHaveAttribute("aria-current", "true");
  });

  it("stale view is active only when stale is set", () => {
    renderNav({ ...DEFAULT_QUERY, stale: true });
    expect(screen.getByRole("link", { name: /^3일 이상 미처리/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /^전체/ })).not.toHaveAttribute("aria-current");
  });

  it("lists types in typeOrder with counts and links", () => {
    renderNav();
    const list = screen.getByRole("list", { name: "유형" });
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["계정/로그인6", "결제/환불8"]);
    expect(links[1]).toHaveAttribute("href", "/games/g1/inquiries?type=payment_refund");
  });

  it("shows the new badge only when there is something new", () => {
    renderNav(DEFAULT_QUERY, { ...counts, status: { ...counts.status, new: 0 } });
    expect(within(screen.getByRole("link", { name: /^접수/ })).queryByText("0")).not.toBeInTheDocument();
  });

  it("renders without numbers when counts are unavailable", () => {
    renderNav(DEFAULT_QUERY, null);
    expect(screen.getByText("문의함")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "접수" })).toBeInTheDocument();
  });

  it("keeps the selected inquiry when switching views", () => {
    renderNav(DEFAULT_QUERY, counts, "i1");
    expect(screen.getByRole("link", { name: /^처리중/ })).toHaveAttribute("href", "/games/g1/inquiries/i1?status=in_progress");
  });

  it("links to templates and offers game deletion", () => {
    renderNav();
    expect(screen.getByRole("link", { name: "답변 템플릿" })).toHaveAttribute("href", "/games/g1/templates");
    expect(screen.getByRole("button", { name: /삭제/ })).toBeInTheDocument();
  });

  it("links to the operations assistant in a new tab for a game", () => {
    renderNav();
    const link = screen.getByRole("link", { name: /운영 어시스턴트/ });
    expect(link).toHaveAttribute("href", "/games/g1/assistant");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
  });

  it("does not show the assistant link for service inquiries", () => {
    renderServiceNav();
    expect(screen.queryByRole("link", { name: /운영 어시스턴트/ })).not.toBeInTheDocument();
  });

  describe("service scope", () => {
    it("shows the service title without a game status badge", () => {
      renderServiceNav();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("서비스 문의");
      expect(screen.queryByText("서비스중")).not.toBeInTheDocument();
      expect(screen.queryByText("종료")).not.toBeInTheDocument();
      expect(screen.getByText("문의함 · 전체 23건")).toBeInTheDocument();
    });

    it("links views and types under /service/inquiries", () => {
      renderServiceNav({ ...DEFAULT_QUERY, sort: "oldest" }, "i1");
      expect(screen.getByRole("link", { name: /^접수/ })).toHaveAttribute("href", "/service/inquiries/i1?status=new&sort=oldest");
      const list = screen.getByRole("list", { name: "유형" });
      const links = within(list).getAllByRole("link");
      expect(links.map((l) => l.textContent)).toEqual(["퍼블리싱 제휴0", "언론·보도 문의0"]);
      expect(links[0]).toHaveAttribute("href", "/service/inquiries/i1?type=publishing&sort=oldest");
    });

    it("has no template link and no delete button", () => {
      renderServiceNav();
      expect(screen.queryByRole("link", { name: "답변 템플릿" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /삭제/ })).not.toBeInTheDocument();
    });
  });
});
