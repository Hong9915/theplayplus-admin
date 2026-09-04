// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InboxList from "@/components/inbox/InboxList";
import type { InquiryPage, InquiryRow } from "@/lib/inquiries";
import { DEFAULT_QUERY, type InquiryListQuery } from "@/lib/inquiry-filters";
import { gameScope } from "@/lib/inbox-scope";

const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
const prefetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh, prefetch }) }));

function makeInquiry(overrides: Partial<InquiryRow>): InquiryRow {
  return {
    id: "aaaabbbb-0000-0000-0000-000000000000",
    gameId: "g1",
    groupKey: "game_usage",
    typeKey: "bug_report",
    gameAccount: "user#1234",
    companyName: null,
    replyEmail: "user@example.com",
    title: "버그 신고합니다",
    content: "첫 줄입니다\n둘째 줄",
    status: "new",
    priority: "normal",
    meta: {},
    draftReply: null,
    inquiryNo: "R-20260101-0001",
    replyContent: null,
    repliedAt: null,
    gmailThreadId: null,
    locale: null,
    paymentNo: null,
    occurredAt: null,
    deviceInfo: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePage(rows: InquiryRow[], total = rows.length, page = 1, pageSize = 50): InquiryPage {
  return { rows, total, page, pageSize };
}

const labels = {
  groupLabels: { game_usage: "게임 이용 문의" },
  typeLabels: { bug_report: "버그·오류 신고" },
  typeOrder: ["bug_report"],
};

function renderList(page: InquiryPage, query: InquiryListQuery = DEFAULT_QUERY, selectedId: string | null = null) {
  return render(<InboxList scope={gameScope("g1")} page={page} query={query} labels={labels} selectedId={selectedId} viewLabel="전체" />);
}

describe("InboxList", () => {
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
    prefetch.mockReset();
    refresh.mockReset();
  });

  it("shows the view label and total", () => {
    renderList(makePage([makeInquiry({})], 37));
    expect(screen.getByText("전체")).toBeInTheDocument();
    expect(screen.getByText("37건")).toBeInTheDocument();
  });

  it("renders a card row with number, elapsed, title, first content line, badge, type, and priority", () => {
    renderList(makePage([makeInquiry({ priority: "urgent" })]));
    expect(screen.getByText("R-20260101-0001")).toBeInTheDocument();
    expect(screen.getByText("0분")).toBeInTheDocument();
    expect(screen.getByText("버그 신고합니다")).toBeInTheDocument();
    expect(screen.getByText("첫 줄입니다")).toBeInTheDocument();
    expect(screen.queryByText(/둘째 줄/)).not.toBeInTheDocument();
    expect(screen.getByText("접수")).toBeInTheDocument();
    expect(screen.getByText("버그·오류 신고")).toBeInTheDocument();
    expect(screen.getByText("긴급")).toBeInTheDocument();
  });

  it("hides normal and low priority", () => {
    renderList(makePage([makeInquiry({ priority: "low" })]));
    expect(screen.queryByText("낮음")).not.toBeInTheDocument();
  });

  it("navigates to the inquiry keeping the query when a row is clicked", async () => {
    renderList(makePage([makeInquiry({})]), { ...DEFAULT_QUERY, status: "new" });
    await userEvent.click(screen.getByText("버그 신고합니다"));
    expect(push).toHaveBeenCalledWith("/games/g1/inquiries/aaaabbbb-0000-0000-0000-000000000000?status=new");
  });

  it("highlights the clicked row right away while the navigation is pending", async () => {
    renderList(makePage([makeInquiry({}), makeInquiry({ id: "second", title: "두 번째" })]), DEFAULT_QUERY, "aaaabbbb-0000-0000-0000-000000000000");
    await userEvent.click(screen.getByText("두 번째"));
    const rows = screen.getAllByRole("listitem");
    expect(rows[1]).toHaveAttribute("aria-current", "true");
    expect(rows[1]).toHaveAttribute("aria-busy", "true");
    expect(rows[0]).not.toHaveAttribute("aria-current");
  });

  it("prefetches a row when the pointer enters it", async () => {
    renderList(makePage([makeInquiry({})]), { ...DEFAULT_QUERY, status: "new" });
    await userEvent.hover(screen.getByText("버그 신고합니다"));
    expect(prefetch).toHaveBeenCalledWith("/games/g1/inquiries/aaaabbbb-0000-0000-0000-000000000000?status=new");
  });

  it("marks the selected row", () => {
    renderList(makePage([makeInquiry({})]), DEFAULT_QUERY, "aaaabbbb-0000-0000-0000-000000000000");
    expect(screen.getByRole("listitem")).toHaveAttribute("aria-current", "true");
  });

  it("changing the sort rewrites the URL and keeps the selection", async () => {
    renderList(makePage([]), DEFAULT_QUERY, "i1");
    await userEvent.selectOptions(screen.getByLabelText("정렬"), "priority");
    expect(replace).toHaveBeenCalledWith("/games/g1/inquiries/i1?sort=priority");
  });

  it("shows empty states", () => {
    renderList(makePage([]));
    expect(screen.getByText("접수된 문의가 없습니다.")).toBeInTheDocument();
    renderList(makePage([]), { ...DEFAULT_QUERY, status: "resolved" });
    expect(screen.getByText("조건에 맞는 문의가 없습니다.")).toBeInTheDocument();
  });

  describe("pagination", () => {
    it("shows only the range when everything fits", () => {
      renderList(makePage([makeInquiry({})], 10));
      expect(screen.getByText("1–10 / 10건")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "다음" })).not.toBeInTheDocument();
    });

    it("moves between pages without resetting filters", async () => {
      renderList(makePage([makeInquiry({})], 120, 2), { ...DEFAULT_QUERY, status: "new", page: 2 });
      expect(screen.getByText("51–100 / 120건")).toBeInTheDocument();
      expect(screen.getByText("2 / 3")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "다음" }));
      expect(replace).toHaveBeenCalledWith("/games/g1/inquiries?status=new&page=3");
      await userEvent.click(screen.getByRole("button", { name: "이전" }));
      expect(replace).toHaveBeenCalledWith("/games/g1/inquiries?status=new");
    });

    it("disables the edge buttons", () => {
      renderList(makePage([makeInquiry({})], 120, 3), { ...DEFAULT_QUERY, page: 3 });
      expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "이전" })).not.toBeDisabled();
    });
  });

  describe("bulk status", () => {
    const rows = [
      makeInquiry({ id: "11111111-0000-0000-0000-000000000000", title: "첫째" }),
      makeInquiry({ id: "22222222-0000-0000-0000-000000000000", title: "둘째" }),
    ];

    it("hides the bulk bar until something is selected", () => {
      renderList(makePage(rows));
      expect(screen.queryByRole("button", { name: "상태 변경" })).not.toBeInTheDocument();
    });

    it("selects all, applies the chosen status, and refreshes", async () => {
      global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true, updated: 2 }) }) as never;
      renderList(makePage(rows));

      await userEvent.click(screen.getByLabelText("이 페이지 전체 선택"));
      expect(screen.getByText("선택 2건")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "상태 변경" }));

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/inquiries/bulk-status",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            ids: ["11111111-0000-0000-0000-000000000000", "22222222-0000-0000-0000-000000000000"],
            status: "resolved",
          }),
        })
      );
      expect(await screen.findByText("2건의 상태를 변경했습니다.")).toBeInTheDocument();
      expect(refresh).toHaveBeenCalled();
      expect(screen.queryByText("선택 2건")).not.toBeInTheDocument();
    });

    it("lets the admin pick a different target status", async () => {
      global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true, updated: 1 }) }) as never;
      renderList(makePage(rows));
      await userEvent.click(screen.getByLabelText("첫째 선택"));
      await userEvent.selectOptions(screen.getByLabelText("일괄 변경 상태"), "in_progress");
      await userEvent.click(screen.getByRole("button", { name: "상태 변경" }));
      const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body).toEqual({ ids: ["11111111-0000-0000-0000-000000000000"], status: "in_progress" });
    });

    it("does not navigate when the checkbox is clicked", async () => {
      renderList(makePage(rows));
      await userEvent.click(screen.getByLabelText("첫째 선택"));
      expect(push).not.toHaveBeenCalled();
    });

    it("shows an error and keeps the selection when the request fails", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("down")) as never;
      renderList(makePage(rows));
      await userEvent.click(screen.getByLabelText("첫째 선택"));
      await userEvent.click(screen.getByRole("button", { name: "상태 변경" }));
      expect(await screen.findByText("상태 변경에 실패했습니다.")).toBeInTheDocument();
      expect(screen.getByText("선택 1건")).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
