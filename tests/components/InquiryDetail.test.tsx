// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryDetail from "@/components/inquiries/InquiryDetail";
import type { InquiryRow } from "@/lib/inquiries";

describe("InquiryDetail", () => {
  const inquiry: InquiryRow = {
    id: "inq-1",
    gameId: "game-1",
    groupKey: "game_usage",
    typeKey: "bug_report",
    gameAccount: "player1",
    companyName: null,
    replyEmail: "user@example.com",
    title: "버그 제보",
    content: "화면이 멈춰요",
    status: "new",
    replyContent: null,
    repliedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("renders the inquiry content and reply email", () => {
    render(<InquiryDetail inquiry={inquiry} attachments={[]} />);
    expect(screen.getByText("버그 제보")).toBeInTheDocument();
    expect(screen.getByText("화면이 멈춰요")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
  });

  it("renders a link per attachment", () => {
    render(
      <InquiryDetail
        inquiry={inquiry}
        attachments={[{ id: "att-1", fileName: "screenshot.png", signedUrl: "https://signed.example/x" }]}
      />
    );
    const link = screen.getByRole("link", { name: "screenshot.png" });
    expect(link.getAttribute("href")).toBe("https://signed.example/x");
  });

  it("shows the previous reply when the inquiry is already resolved", () => {
    render(
      <InquiryDetail
        inquiry={{ ...inquiry, status: "resolved", replyContent: "확인 후 조치했습니다", repliedAt: "2026-01-02T00:00:00.000Z" }}
        attachments={[]}
      />
    );
    expect(screen.getByText("확인 후 조치했습니다")).toBeInTheDocument();
  });
});
