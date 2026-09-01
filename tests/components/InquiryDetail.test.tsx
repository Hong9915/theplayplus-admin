// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryDetail from "@/components/inquiries/InquiryDetail";
import type { InquiryRow } from "@/lib/inquiries";

const inquiry: InquiryRow = {
  id: "inq-1",
  inquiryNo: "R-20260101-0001",
  gameId: "game-1",
  groupKey: "game_usage",
  typeKey: "bug_report",
  gameAccount: "player1",
  companyName: null,
  replyEmail: "user@example.com",
  title: "버그 제보",
  content: "화면이 멈춰요",
  status: "new",
  priority: "normal",
  meta: {},
  replyContent: null,
  repliedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("InquiryDetail", () => {
  it("renders the inquiry content under a 문의 내용 heading", () => {
    render(<InquiryDetail inquiry={inquiry} attachments={[]} />);
    expect(screen.getByText("문의 내용")).toBeInTheDocument();
    expect(screen.getByText("화면이 멈춰요")).toBeInTheDocument();
  });

  it("does not render the title or reply email (moved to header and meta card)", () => {
    render(<InquiryDetail inquiry={inquiry} attachments={[]} />);
    expect(screen.queryByText("버그 제보")).not.toBeInTheDocument();
    expect(screen.queryByText("user@example.com")).not.toBeInTheDocument();
  });

  it("hides the attachment card when there are no attachments", () => {
    render(<InquiryDetail inquiry={inquiry} attachments={[]} />);
    expect(screen.queryByText("첨부파일")).not.toBeInTheDocument();
  });

  it("renders a link per attachment", () => {
    render(
      <InquiryDetail
        inquiry={inquiry}
        attachments={[{ id: "att-1", fileName: "screenshot.png", signedUrl: "https://signed.example/x" }]}
      />
    );
    expect(screen.getByRole("link", { name: "screenshot.png" })).toHaveAttribute(
      "href",
      "https://signed.example/x"
    );
  });

  it("shows a fallback when an attachment URL could not be signed", () => {
    render(
      <InquiryDetail
        inquiry={inquiry}
        attachments={[{ id: "att-1", fileName: "screenshot.png", signedUrl: null }]}
      />
    );
    expect(screen.getByText("screenshot.png (링크 생성 실패)")).toBeInTheDocument();
  });

  it("shows the previous reply when the inquiry is already resolved", () => {
    render(
      <InquiryDetail
        inquiry={{
          ...inquiry,
          status: "resolved",
          replyContent: "확인 후 조치했습니다",
          repliedAt: "2026-01-02T00:00:00.000Z",
        }}
        attachments={[]}
      />
    );
    expect(screen.getByText("확인 후 조치했습니다")).toBeInTheDocument();
  });
});
