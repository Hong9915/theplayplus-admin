// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InquiryMailbox from "@/components/inquiries/InquiryMailbox";
import type { InquiryPage, InquiryRow } from "@/lib/inquiries";
import { DEFAULT_QUERY, type InquiryListQuery } from "@/lib/inquiry-filters";

const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh }),
  usePathname: () => "/games/game-1/inquiries",
}));

function makeInquiry(overrides: Partial<InquiryRow>): InquiryRow {
  return {
    id: "aaaabbbb-0000-0000-0000-000000000000",
    gameId: "game-1",
    groupKey: "game_usage",
    typeKey: "bug_report",
    gameAccount: "user#1234",
    companyName: null,
    replyEmail: "user@example.com",
    title: "버그 신고합니다",
    content: "본문",
    status: "new",
    priority: "normal",
    meta: {},
    draftReply: null,
    inquiryNo: "R-20260101-0001",
    replyContent: null,
    repliedAt: null,
    gmailThreadId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePage(rows: InquiryRow[], total = rows.length, page = 1, pageSize = 50): InquiryPage {
  return { rows, total, page, pageSize };
}

const labels = {
  groupLabels: { game_usage: "게임 이용 문의", business: "사업 제휴 문의" },
  typeLabels: { bug_report: "버그·오류 신고", publishing: "퍼블리싱/유통 제휴" },
};

function renderMailbox(page: InquiryPage, query: InquiryListQuery = DEFAULT_QUERY) {
  return render(<InquiryMailbox page={page} query={query} labels={labels} />);
}

describe("InquiryMailbox", () => {
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
    refresh.mockReset();
  });

  it("shows an empty state when the game has no inquiries", () => {
    renderMailbox(makePage([]));
    expect(screen.getByText("접수된 문의가 없습니다.")).toBeInTheDocument();
  });

  it("shows a no-match message when a filter is active and nothing came back", () => {
    renderMailbox(makePage([]), { ...DEFAULT_QUERY, status: "resolved" });
    expect(screen.getByText("조건에 맞는 문의가 없습니다.")).toBeInTheDocument();
  });

  it("renders inquiries with Korean category labels, priority, and the total count", () => {
    renderMailbox(makePage([makeInquiry({ priority: "urgent" })], 37));
    const table = within(screen.getByRole("table"));
    expect(table.getByText("게임 이용 문의")).toBeInTheDocument();
    expect(table.getByText("버그·오류 신고")).toBeInTheDocument();
    expect(table.getByText("버그 신고합니다")).toBeInTheDocument();
    expect(table.getByText("긴급")).toBeInTheDocument();
    expect(screen.getByText("37건")).toBeInTheDocument();
  });

  it("falls back to raw keys when a label is missing", () => {
    render(
      <InquiryMailbox
        page={makePage([makeInquiry({ groupKey: "unknown_group", typeKey: "unknown_type" })])}
        query={DEFAULT_QUERY}
        labels={{ groupLabels: {}, typeLabels: {} }}
      />
    );
    expect(screen.getByText("unknown_group")).toBeInTheDocument();
    expect(screen.getByText("unknown_type")).toBeInTheDocument();
  });

  it("reflects the current query in the controls", () => {
    renderMailbox(makePage([]), { ...DEFAULT_QUERY, status: "in_progress", sort: "oldest", q: "환불", group: "business" });
    expect(screen.getByLabelText("상태 필터")).toHaveValue("in_progress");
    expect(screen.getByLabelText("정렬")).toHaveValue("oldest");
    expect(screen.getByLabelText("검색")).toHaveValue("환불");
    expect(screen.getByLabelText("종류 필터")).toHaveValue("business");
  });

  it("changing a filter rewrites the URL and resets to page 1", async () => {
    renderMailbox(makePage([makeInquiry({})]), { ...DEFAULT_QUERY, page: 3, sort: "oldest" });

    await userEvent.selectOptions(screen.getByLabelText("상태 필터"), "resolved");

    expect(replace).toHaveBeenCalledWith("/games/game-1/inquiries?status=resolved&sort=oldest");
  });

  it("clearing every filter goes back to the bare path", async () => {
    renderMailbox(makePage([]), { ...DEFAULT_QUERY, status: "resolved" });
    await userEvent.selectOptions(screen.getByLabelText("상태 필터"), "all");
    expect(replace).toHaveBeenCalledWith("/games/game-1/inquiries");
  });

  it("changing the sort rewrites the URL", async () => {
    renderMailbox(makePage([]));
    await userEvent.selectOptions(screen.getByLabelText("정렬"), "priority");
    expect(replace).toHaveBeenCalledWith("/games/game-1/inquiries?sort=priority");
  });

  it("debounces the search box into the URL", async () => {
    renderMailbox(makePage([]));

    await userEvent.type(screen.getByLabelText("검색"), "결제");

    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/games/game-1/inquiries?q=%EA%B2%B0%EC%A0%9C"));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("links each row title to the detail page, carrying the list state", () => {
    renderMailbox(makePage([makeInquiry({})]), { ...DEFAULT_QUERY, status: "new" });
    expect(screen.getByRole("link", { name: "버그 신고합니다" })).toHaveAttribute(
      "href",
      "/inquiries/aaaabbbb-0000-0000-0000-000000000000?list=status%3Dnew"
    );
  });

  it("shows the inquiry number and an em dash when missing", () => {
    renderMailbox(makePage([makeInquiry({ inquiryNo: null })]));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows elapsed time in minutes for a fresh inquiry", () => {
    renderMailbox(makePage([makeInquiry({})]));
    expect(screen.getByText("0분")).toBeInTheDocument();
  });

  describe("pagination", () => {
    it("is hidden when everything fits on one page", () => {
      renderMailbox(makePage([makeInquiry({})], 10));
      expect(screen.queryByRole("navigation", { name: "페이지" })).not.toBeInTheDocument();
    });

    it("shows the range and moves between pages without resetting filters", async () => {
      renderMailbox(makePage([makeInquiry({})], 120, 2), { ...DEFAULT_QUERY, status: "new", page: 2 });

      expect(screen.getByText("51–100 / 120건")).toBeInTheDocument();
      expect(screen.getByText("2 / 3")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "다음" }));
      expect(replace).toHaveBeenCalledWith("/games/game-1/inquiries?status=new&page=3");

      await userEvent.click(screen.getByRole("button", { name: "이전" }));
      expect(replace).toHaveBeenCalledWith("/games/game-1/inquiries?status=new");
    });

    it("disables the edge buttons", () => {
      renderMailbox(makePage([makeInquiry({})], 120, 3), { ...DEFAULT_QUERY, page: 3 });
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
      renderMailbox(makePage(rows));
      expect(screen.queryByRole("button", { name: "상태 변경" })).not.toBeInTheDocument();
    });

    it("selects rows, applies the chosen status, and refreshes", async () => {
      global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true, updated: 2 }) }) as never;
      renderMailbox(makePage(rows));

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
      // 선택은 풀린다.
      expect(screen.queryByText("선택 2건")).not.toBeInTheDocument();
    });

    it("lets the admin pick a different target status", async () => {
      global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true, updated: 1 }) }) as never;
      renderMailbox(makePage(rows));

      await userEvent.click(screen.getByLabelText("첫째 선택"));
      await userEvent.selectOptions(screen.getByLabelText("일괄 변경 상태"), "in_progress");
      await userEvent.click(screen.getByRole("button", { name: "상태 변경" }));

      const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body).toEqual({ ids: ["11111111-0000-0000-0000-000000000000"], status: "in_progress" });
    });

    it("does not navigate when the checkbox cell is clicked", async () => {
      renderMailbox(makePage(rows));
      await userEvent.click(screen.getByLabelText("첫째 선택"));
      expect(push).not.toHaveBeenCalled();
    });

    it("shows an error and keeps the selection when the request fails", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("down")) as never;
      renderMailbox(makePage(rows));

      await userEvent.click(screen.getByLabelText("첫째 선택"));
      await userEvent.click(screen.getByRole("button", { name: "상태 변경" }));

      expect(await screen.findByText("상태 변경에 실패했습니다.")).toBeInTheDocument();
      expect(screen.getByText("선택 1건")).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
