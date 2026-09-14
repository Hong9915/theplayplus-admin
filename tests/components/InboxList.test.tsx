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
// 라우터 컨텍스트 없는 next/link는 클릭을 그대로 흘려 jsdom이 "navigation not implemented"를 찍는다.
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, onClick, ...rest }: React.ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

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
    unreadReplyAt: null,
    locale: null,
    translations: {},
    paymentNo: null,
    store: null,
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
    window.localStorage.clear();
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

  it("marks rows that have an unread user reply", () => {
    renderList(makePage([makeInquiry({ unreadReplyAt: "2026-09-07T01:00:00.000Z" }), makeInquiry({ id: "other", title: "다른 문의" })]));
    expect(screen.getAllByText("회신 옴")).toHaveLength(1);
  });

  it("hides normal and low priority", () => {
    renderList(makePage([makeInquiry({ priority: "low" })]));
    expect(screen.queryByText("낮음")).not.toBeInTheDocument();
  });

  it("renders each row as a real link to the inquiry that keeps the query", () => {
    renderList(makePage([makeInquiry({})]), { ...DEFAULT_QUERY, status: "new" });
    expect(screen.getByRole("link", { name: /버그 신고합니다/ })).toHaveAttribute(
      "href",
      "/games/g1/inquiries/aaaabbbb-0000-0000-0000-000000000000?status=new"
    );
  });

  it("measures elapsed time from the clock the server passed so hydration matches", () => {
    const now = Date.parse("2026-09-07T10:00:00.000Z");
    const { unmount } = render(
      <InboxList
        scope={gameScope("g1")}
        page={makePage([makeInquiry({ createdAt: "2026-09-07T09:55:00.000Z" })])}
        query={DEFAULT_QUERY}
        labels={labels}
        selectedId={null}
        viewLabel="전체"
        now={now}
      />
    );
    expect(screen.getByText("5분")).toBeInTheDocument();
    unmount();
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

    it("links to the neighbouring pages without resetting filters", () => {
      renderList(makePage([makeInquiry({})], 120, 2), { ...DEFAULT_QUERY, status: "new", page: 2 });
      expect(screen.getByText("51–100 / 120건")).toBeInTheDocument();
      expect(screen.getByText("2 / 3")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "다음" })).toHaveAttribute("href", "/games/g1/inquiries?status=new&page=3");
      expect(screen.getByRole("link", { name: "이전" })).toHaveAttribute("href", "/games/g1/inquiries?status=new");
    });

    it("keeps the selected inquiry in the page links", () => {
      renderList(makePage([makeInquiry({})], 120, 1), DEFAULT_QUERY, "i1");
      expect(screen.getByRole("link", { name: "다음" })).toHaveAttribute("href", "/games/g1/inquiries/i1?page=2");
    });

    it("renders the edge controls as disabled text instead of links", () => {
      renderList(makePage([makeInquiry({})], 120, 3), { ...DEFAULT_QUERY, page: 3 });
      expect(screen.queryByRole("link", { name: "다음" })).not.toBeInTheDocument();
      expect(screen.getByText("다음")).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("link", { name: "이전" })).toBeInTheDocument();
    });
  });

  describe("collapse", () => {
    it("hides the list and shows an expand button when collapsed", async () => {
      renderList(makePage([makeInquiry({})], 37));
      await userEvent.click(screen.getByRole("button", { name: "목록 접기" }));
      expect(screen.queryByText("37건")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "목록 펼치기" })).toBeInTheDocument();
    });

    it("shows the list again after expanding", async () => {
      renderList(makePage([makeInquiry({})], 37));
      await userEvent.click(screen.getByRole("button", { name: "목록 접기" }));
      await userEvent.click(screen.getByRole("button", { name: "목록 펼치기" }));
      expect(screen.getByText("37건")).toBeInTheDocument();
    });

    it("remembers the collapsed state across remounts", () => {
      window.localStorage.setItem("inbox-list-collapsed", "true");
      renderList(makePage([makeInquiry({})], 37));
      expect(screen.queryByText("37건")).not.toBeInTheDocument();
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

    it("does not mark the row pending when only the checkbox is clicked", async () => {
      renderList(makePage(rows));
      await userEvent.click(screen.getByLabelText("첫째 선택"));
      expect(screen.getAllByRole("listitem")[0]).not.toHaveAttribute("aria-busy");
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
