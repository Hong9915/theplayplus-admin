// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryHeader from "@/components/inquiries/InquiryHeader";
import type { InquiryRow } from "@/lib/inquiries";

const labels = {
  groupLabels: { game_usage: "게임 이용 문의" },
  typeLabels: { bug_report: "버그·오류 신고" },
};

function makeInquiry(overrides: Partial<InquiryRow> = {}): InquiryRow {
  return {
    id: "inq-1",
    inquiryNo: "R-20260723-0005",
    gameId: "game-1",
    groupKey: "game_usage",
    typeKey: "bug_report",
    gameAccount: "player1",
    companyName: null,
    replyEmail: "user@example.com",
    title: "자동전투 3배속 추가해주세요",
    content: "본문",
    status: "new",
    priority: "normal",
    meta: {},
    draftReply: null,
    replyContent: null,
    repliedAt: null,
    gmailThreadId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("InquiryHeader", () => {
  it("renders the inquiry number, title, and Korean category labels", () => {
    render(<InquiryHeader inquiry={makeInquiry()} labels={labels} />);
    expect(screen.getByText("R-20260723-0005")).toBeInTheDocument();
    expect(screen.getByText("자동전투 3배속 추가해주세요")).toBeInTheDocument();
    expect(screen.getByText("게임 이용 문의")).toBeInTheDocument();
    expect(screen.getByText("버그·오류 신고")).toBeInTheDocument();
  });

  it("shows an em dash when the inquiry has no number yet", () => {
    render(<InquiryHeader inquiry={makeInquiry({ inquiryNo: null })} labels={labels} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("falls back to raw keys when a label is missing", () => {
    render(<InquiryHeader inquiry={makeInquiry()} labels={{ groupLabels: {}, typeLabels: {} }} />);
    expect(screen.getByText("game_usage")).toBeInTheDocument();
    expect(screen.getByText("bug_report")).toBeInTheDocument();
  });

  it("shows the elapsed time as minutes for a fresh inquiry", () => {
    render(<InquiryHeader inquiry={makeInquiry()} labels={labels} />);
    expect(screen.getByText(/경과 0분/)).toBeInTheDocument();
  });
});
