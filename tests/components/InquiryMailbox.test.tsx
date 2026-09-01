// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InquiryMailbox from "@/components/inquiries/InquiryMailbox";
import type { InquiryRow } from "@/lib/inquiries";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
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
    replyContent: null,
    repliedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const labels = {
  groupLabels: { game_usage: "게임 이용 문의", business: "사업 제휴 문의" },
  typeLabels: { bug_report: "버그·오류 신고", publishing: "퍼블리싱/유통 제휴" },
};

describe("InquiryMailbox", () => {
  it("shows an empty state when there are no inquiries", () => {
    render(<InquiryMailbox inquiries={[]} labels={labels} />);
    expect(screen.getByText("접수된 문의가 없습니다.")).toBeInTheDocument();
  });

  it("renders inquiries with Korean category labels and a count", () => {
    render(<InquiryMailbox inquiries={[makeInquiry({})]} labels={labels} />);
    const table = within(screen.getByRole("table"));
    expect(table.getByText("게임 이용 문의")).toBeInTheDocument();
    expect(table.getByText("버그·오류 신고")).toBeInTheDocument();
    expect(table.getByText("버그 신고합니다")).toBeInTheDocument();
    expect(screen.getByText("1건")).toBeInTheDocument();
  });

  it("falls back to raw keys when a label is missing", () => {
    render(
      <InquiryMailbox
        inquiries={[makeInquiry({ groupKey: "unknown_group", typeKey: "unknown_type" })]}
        labels={{ groupLabels: {}, typeLabels: {} }}
      />
    );
    expect(screen.getByText("unknown_group")).toBeInTheDocument();
    expect(screen.getByText("unknown_type")).toBeInTheDocument();
  });

  it("filters by status", async () => {
    render(
      <InquiryMailbox
        inquiries={[
          makeInquiry({ id: "11111111-0000-0000-0000-000000000000", title: "신규 문의", status: "new" }),
          makeInquiry({ id: "22222222-0000-0000-0000-000000000000", title: "완료된 문의", status: "resolved" }),
        ]}
        labels={labels}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("상태 필터"), "resolved");

    expect(screen.queryByText("신규 문의")).not.toBeInTheDocument();
    expect(screen.getByText("완료된 문의")).toBeInTheDocument();
    expect(screen.getByText("1건")).toBeInTheDocument();
  });

  it("filters by title search", async () => {
    render(
      <InquiryMailbox
        inquiries={[
          makeInquiry({ id: "11111111-0000-0000-0000-000000000000", title: "결제 오류" }),
          makeInquiry({ id: "22222222-0000-0000-0000-000000000000", title: "계정 복구 요청" }),
        ]}
        labels={labels}
      />
    );

    await userEvent.type(screen.getByLabelText("제목 검색"), "결제");

    expect(screen.getByText("결제 오류")).toBeInTheDocument();
    expect(screen.queryByText("계정 복구 요청")).not.toBeInTheDocument();
  });

  it("shows a no-match message when filters exclude everything", async () => {
    render(<InquiryMailbox inquiries={[makeInquiry({})]} labels={labels} />);
    await userEvent.type(screen.getByLabelText("제목 검색"), "없는검색어");
    expect(screen.getByText("조건에 맞는 문의가 없습니다.")).toBeInTheDocument();
  });

  it("links each row title to the inquiry detail page", () => {
    render(<InquiryMailbox inquiries={[makeInquiry({})]} labels={labels} />);
    expect(screen.getByRole("link", { name: "버그 신고합니다" })).toHaveAttribute(
      "href",
      "/inquiries/aaaabbbb-0000-0000-0000-000000000000"
    );
  });
});
