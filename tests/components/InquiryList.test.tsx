// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import InquiryList from "@/components/inquiries/InquiryList";
import type { InquiryRow } from "@/lib/inquiries";

describe("InquiryList", () => {
  const inquiries: InquiryRow[] = [
    {
      id: "inq-1",
      gameId: "game-1",
      groupKey: "game_usage",
      typeKey: "bug_report",
      gameAccount: "player1",
      companyName: null,
      replyEmail: "a@b.com",
      title: "버그 제보",
      content: "내용",
      status: "new",
      replyContent: null,
      repliedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("renders a link per inquiry with title and status", () => {
    render(<InquiryList inquiries={inquiries} activeStatus="all" gameId="game-1" />);
    expect(screen.getByText("버그 제보")).toBeInTheDocument();
    const item = screen.getByText("버그 제보").closest("li")!;
    expect(within(item).getByText("접수")).toBeInTheDocument();
  });

  it("renders status filter links including the current game id", () => {
    render(<InquiryList inquiries={inquiries} activeStatus="all" gameId="game-1" />);
    const link = screen.getByRole("link", { name: "처리중" });
    expect(link.getAttribute("href")).toBe("/games/game-1/inquiries?status=in_progress");
  });

  it("shows an empty state when there are no inquiries", () => {
    render(<InquiryList inquiries={[]} activeStatus="all" gameId="game-1" />);
    expect(screen.getByText("접수된 문의가 없습니다.")).toBeInTheDocument();
  });
});
