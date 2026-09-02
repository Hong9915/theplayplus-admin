// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryThread from "@/components/inquiries/InquiryThread";
import type { MessageRow } from "@/lib/messages";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const messages: MessageRow[] = [
  {
    id: "m1",
    direction: "outbound",
    authorEmail: "info@theplayplus.com",
    body: "확인 후 조치했습니다",
    gmailMessageId: "gm-1",
    rfcMessageId: "<a@theplayplus.com>",
    sentAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "m2",
    direction: "inbound",
    authorEmail: "user@example.com",
    body: "감사합니다, 해결됐어요",
    gmailMessageId: "gm-2",
    rfcMessageId: null,
    sentAt: "2026-09-01T01:00:00.000Z",
  },
];

describe("InquiryThread", () => {
  it("renders nothing when there are no messages", () => {
    const { container } = render(<InquiryThread inquiryId="inq-1" messages={[]} hasGmailThread={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows sent replies and user replies in order with a count", () => {
    render(<InquiryThread inquiryId="inq-1" messages={messages} hasGmailThread />);
    expect(screen.getByText("2건")).toBeInTheDocument();
    expect(screen.getByText("확인 후 조치했습니다")).toBeInTheDocument();
    expect(screen.getByText("감사합니다, 해결됐어요")).toBeInTheDocument();
    expect(screen.getByText("보낸 답변")).toBeInTheDocument();
    expect(screen.getByText("사용자 회신")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-direction", "outbound");
    expect(items[1]).toHaveAttribute("data-direction", "inbound");
  });

  it("offers a sync button only when a Gmail thread exists", () => {
    const { rerender } = render(<InquiryThread inquiryId="inq-1" messages={messages} hasGmailThread />);
    expect(screen.getByRole("button", { name: "회신 확인" })).toBeInTheDocument();

    rerender(<InquiryThread inquiryId="inq-1" messages={messages} hasGmailThread={false} />);
    expect(screen.queryByRole("button", { name: "회신 확인" })).not.toBeInTheDocument();
  });
});
