// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryMetaCard from "@/components/inquiries/InquiryMetaCard";
import type { InquiryRow } from "@/lib/inquiries";

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
    title: "제목",
    content: "본문",
    status: "new",
    priority: "normal",
    meta: {},
    draftReply: null,
    replyContent: null,
    repliedAt: null,
    createdAt: "2026-07-23T13:55:00.000Z",
    ...overrides,
  };
}

describe("InquiryMetaCard", () => {
  it("renders the fixed fields that have values", () => {
    render(<InquiryMetaCard inquiry={makeInquiry()} />);
    expect(screen.getByText("접수 정보")).toBeInTheDocument();
    expect(screen.getByText("게임 계정")).toBeInTheDocument();
    expect(screen.getByText("player1")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
  });

  it("omits fixed fields that are empty", () => {
    render(<InquiryMetaCard inquiry={makeInquiry({ gameAccount: null, companyName: null })} />);
    expect(screen.queryByText("게임 계정")).not.toBeInTheDocument();
    expect(screen.queryByText("회사명")).not.toBeInTheDocument();
  });

  it("renders meta values with Korean labels", () => {
    render(
      <InquiryMetaCard
        inquiry={makeInquiry({ meta: { uid: "10024871", device: "SM-S938N", custom_field: "x" } })}
      />
    );
    expect(screen.getByText("UID")).toBeInTheDocument();
    expect(screen.getByText("10024871")).toBeInTheDocument();
    expect(screen.getByText("기기")).toBeInTheDocument();
    expect(screen.getByText("custom_field")).toBeInTheDocument();
  });

  it("renders nothing extra when meta is empty", () => {
    render(<InquiryMetaCard inquiry={makeInquiry({ meta: {} })} />);
    expect(screen.queryByText("UID")).not.toBeInTheDocument();
  });
});
