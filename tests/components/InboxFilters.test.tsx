// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InboxFilters from "@/components/inbox/InboxFilters";
import { DEFAULT_QUERY, type InquiryListQuery } from "@/lib/inquiry-filters";
import type { InquiryFacetCounts } from "@/lib/inquiries";
import { SERVICE_SCOPE, gameScope } from "@/lib/inbox-scope";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace }) }));

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
  unread: 3,
};

function renderFilters(query: InquiryListQuery = DEFAULT_QUERY, c: InquiryFacetCounts | null = counts, selectedId: string | null = null) {
  return render(<InboxFilters scope={gameScope("g1")} query={query} labels={labels} counts={c} selectedId={selectedId} />);
}

describe("InboxFilters", () => {
  beforeEach(() => replace.mockClear());

  it("links each view to a query that resets the page", () => {
    renderFilters({ ...DEFAULT_QUERY, page: 3, sort: "oldest" });
    expect(screen.getByRole("link", { name: /^접수/ })).toHaveAttribute("href", "/games/g1/inquiries?status=new&sort=oldest");
    expect(screen.getByRole("link", { name: /^처리중/ })).toHaveAttribute("href", "/games/g1/inquiries?status=in_progress&sort=oldest");
    expect(screen.getByRole("link", { name: /^3일 이상 미처리/ })).toHaveAttribute("href", "/games/g1/inquiries?stale=1&sort=oldest");
  });

  it("orders views by how often they are opened", () => {
    renderFilters();
    const views = within(screen.getByRole("list", { name: "보기" })).getAllByRole("link");
    expect(views.map((v) => v.textContent?.replace(/\d+$/, ""))).toEqual(["접수", "처리중", "회신 도착", "3일 이상 미처리", "완료", "전체"]);
  });

  it("전체 clears status, stale, unread, priority, and type but keeps the search and sort", () => {
    renderFilters({ ...DEFAULT_QUERY, status: "new", type: "account_login", priority: "high", stale: true, unread: true, q: "x", sort: "priority" });
    expect(screen.getByRole("link", { name: /^전체/ })).toHaveAttribute("href", "/games/g1/inquiries?q=x&sort=priority");
  });

  it("offers a 회신 도착 view with its count that swaps out the status and stale filters", () => {
    renderFilters({ ...DEFAULT_QUERY, status: "new", stale: true });
    const link = screen.getByRole("link", { name: /^회신 도착/ });
    expect(link).toHaveAttribute("href", "/games/g1/inquiries?unread=1");
    expect(within(link).getByText("3")).toBeInTheDocument();
  });

  it("marks only the active view", () => {
    renderFilters({ ...DEFAULT_QUERY, unread: true });
    expect(screen.getByRole("link", { name: /^회신 도착/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /^전체/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /^접수/ })).toHaveAttribute("href", "/games/g1/inquiries?status=new");
  });

  it("stale view is active only when stale is set", () => {
    renderFilters({ ...DEFAULT_QUERY, stale: true });
    expect(screen.getByRole("link", { name: /^3일 이상 미처리/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /^전체/ })).not.toHaveAttribute("aria-current");
  });

  it("renders views without numbers when counts are unavailable", () => {
    renderFilters(DEFAULT_QUERY, null);
    expect(screen.getByRole("link", { name: "접수" })).toBeInTheDocument();
  });

  it("keeps the selected inquiry when switching views", () => {
    renderFilters(DEFAULT_QUERY, counts, "i1");
    expect(screen.getByRole("link", { name: /^처리중/ })).toHaveAttribute("href", "/games/g1/inquiries/i1?status=in_progress");
  });

  it("lists types in typeOrder with counts and filters by the picked one", async () => {
    renderFilters({ ...DEFAULT_QUERY, group: "game_usage", page: 2 }, counts, "i1");
    const select = screen.getByRole("combobox", { name: "유형" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["모든 유형", "계정/로그인 (6)", "결제/환불 (8)"]);
    await userEvent.selectOptions(select, "payment_refund");
    expect(replace).toHaveBeenCalledWith("/games/g1/inquiries/i1?type=payment_refund");
  });

  it("clears the type when 모든 유형 is picked", async () => {
    renderFilters({ ...DEFAULT_QUERY, type: "account_login" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "유형" }), "");
    expect(replace).toHaveBeenCalledWith("/games/g1/inquiries");
  });

  it("filters by priority and changes the sort", async () => {
    renderFilters();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "우선순위" }), "urgent");
    expect(replace).toHaveBeenLastCalledWith("/games/g1/inquiries?priority=urgent");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "정렬" }), "oldest");
    expect(replace).toHaveBeenLastCalledWith("/games/g1/inquiries?sort=oldest");
  });

  it("links views under /service/inquiries for the service scope", () => {
    render(<InboxFilters scope={SERVICE_SCOPE} query={{ ...DEFAULT_QUERY, sort: "oldest" }} labels={labels} counts={counts} selectedId="i1" />);
    expect(screen.getByRole("link", { name: /^접수/ })).toHaveAttribute("href", "/service/inquiries/i1?status=new&sort=oldest");
  });
});
