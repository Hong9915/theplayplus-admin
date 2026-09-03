// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InboxTimeline from "@/components/inbox/InboxTimeline";
import type { TimelineEntry } from "@/lib/timeline";

const labels = { groupLabels: {}, typeLabels: { payment_refund: "결제/환불", account_login: "계정/로그인" }, typeOrder: [] };

const entries: TimelineEntry[] = [
  {
    kind: "inquiry",
    id: "inq-1",
    at: "2026-09-03T01:12:00.000Z",
    author: "luna_park",
    body: "두 번 결제됐어요",
    details: [
      { key: "발생 일시", label: "발생 일시", value: "2026. 09. 02. 오후 9:00" },
      { key: "결제번호", label: "결제번호", value: "imp_20260902_77" },
    ],
    attachments: [
      { id: "a1", fileName: "명세서.png", signedUrl: "https://signed.example/a1" },
      { id: "a2", fileName: "깨짐.png", signedUrl: null },
    ],
  },
  { kind: "note", id: "n-1", at: "2026-09-03T01:40:00.000Z", author: "hong@theplayplus.com", body: "중복 승인 확인" },
  { kind: "outbound", id: "m-1", at: "2026-09-03T02:05:00.000Z", author: "info@theplayplus.com", body: "환불 처리했습니다" },
  { kind: "inbound", id: "m-2", at: "2026-09-03T04:48:00.000Z", author: "luna@example.com", body: "감사합니다" },
];

describe("InboxTimeline", () => {
  it("renders every entry with its label and body", () => {
    render(<InboxTimeline entries={entries} labels={labels} />);
    expect(screen.getByText("문의 접수")).toBeInTheDocument();
    expect(screen.getByText("두 번 결제됐어요")).toBeInTheDocument();
    expect(screen.getByText("내부 메모")).toBeInTheDocument();
    expect(screen.getByText("중복 승인 확인")).toBeInTheDocument();
    expect(screen.getByText("이메일 발송")).toBeInTheDocument();
    expect(screen.getByText("환불 처리했습니다")).toBeInTheDocument();
    expect(screen.getByText("이메일 회신")).toBeInTheDocument();
    expect(screen.getByText("감사합니다")).toBeInTheDocument();
  });

  it("shows the game account for the inquiry, the id part for staff, and the full email for replies", () => {
    render(<InboxTimeline entries={entries} labels={labels} />);
    expect(screen.getByText("luna_park")).toBeInTheDocument();
    expect(screen.getByText("hong")).toBeInTheDocument();
    expect(screen.getByText("info")).toBeInTheDocument();
    expect(screen.getByText("luna@example.com")).toBeInTheDocument();
  });

  it("renders attachment thumbnails and a failure note", () => {
    render(<InboxTimeline entries={entries} labels={labels} />);
    const img = screen.getByRole("img", { name: "명세서.png" });
    expect(img).toHaveAttribute("src", "https://signed.example/a1");
    expect(screen.getByText("깨짐.png (링크 생성 실패)")).toBeInTheDocument();
  });

  it("shows the type-specific details inside the inquiry bubble", () => {
    render(<InboxTimeline entries={entries} labels={labels} />);
    const details = screen.getByTestId("inquiry-details");
    expect(details).toHaveTextContent("발생 일시");
    expect(details).toHaveTextContent("2026. 09. 02. 오후 9:00");
    expect(details).toHaveTextContent("결제번호");
    expect(details).toHaveTextContent("imp_20260902_77");
  });

  it("omits the detail block when there is nothing to show", () => {
    const inquiry = entries[0];
    if (inquiry.kind !== "inquiry") throw new Error("fixture");
    render(<InboxTimeline entries={[{ ...inquiry, details: [] }]} labels={labels} />);
    expect(screen.queryByTestId("inquiry-details")).not.toBeInTheDocument();
  });

  it("falls back to 사용자 when the inquiry has no account", () => {
    const inquiry = entries[0];
    if (inquiry.kind !== "inquiry") throw new Error("fixture");
    render(<InboxTimeline entries={[{ ...inquiry, author: null, attachments: [] }]} labels={labels} />);
    expect(screen.getByText("사용자")).toBeInTheDocument();
  });

  it("renders a divider per inquiry with number, type label, status, and highlights the current one", () => {
    const withDividers: TimelineEntry[] = [
      { kind: "divider", id: "inq-0", at: "2026-07-21T00:00:00.000Z", inquiryNo: "R-20260721-0002", title: "예전 문의", typeKey: "account_login", status: "resolved", current: false },
      { kind: "divider", id: "inq-1", at: "2026-09-03T01:12:00.000Z", inquiryNo: "R-20260903-0007", title: "중복 결제", typeKey: "payment_refund", status: "in_progress", current: true },
      ...entries,
    ];
    const { container } = render(<InboxTimeline entries={withDividers} labels={labels} />);
    const dividers = container.querySelectorAll('[data-kind="divider"]');
    expect(dividers).toHaveLength(2);
    expect(dividers[0]).toHaveAttribute("data-current", "false");
    expect(dividers[0]).toHaveTextContent("R-20260721-0002");
    expect(dividers[0]).toHaveTextContent("계정/로그인");
    expect(dividers[0]).toHaveTextContent("완료");
    expect(dividers[1]).toHaveAttribute("data-current", "true");
    expect(dividers[1]).toHaveTextContent("결제/환불");
  });
});
