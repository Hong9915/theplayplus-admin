// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InboxTimeline from "@/components/inbox/InboxTimeline";
import type { TimelineEntry } from "@/lib/timeline";

const entries: TimelineEntry[] = [
  {
    kind: "inquiry",
    id: "inq-1",
    at: "2026-09-03T01:12:00.000Z",
    author: "luna_park",
    body: "두 번 결제됐어요",
    attachments: [
      { id: "a1", fileName: "명세서.png", signedUrl: "https://signed.example/a1" },
      { id: "a2", fileName: "깨짐.png", signedUrl: null },
    ],
  },
  { kind: "note", id: "n-1", at: "2026-09-03T01:40:00.000Z", author: "hong@theplayplus.com", body: "중복 승인 확인" },
  { kind: "outbound", id: "m-1", at: "2026-09-03T02:05:00.000Z", author: "info@theplayplus.com", body: "환불 처리했습니다", auto: false },
  { kind: "inbound", id: "m-2", at: "2026-09-03T04:48:00.000Z", author: "luna@example.com", body: "감사합니다" },
];

describe("InboxTimeline", () => {
  it("renders every entry with its label and body", () => {
    render(<InboxTimeline entries={entries} />);
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
    render(<InboxTimeline entries={entries} />);
    expect(screen.getByText("luna_park")).toBeInTheDocument();
    expect(screen.getByText("hong")).toBeInTheDocument();
    expect(screen.getByText("info")).toBeInTheDocument();
    expect(screen.getByText("luna@example.com")).toBeInTheDocument();
  });

  it("renders attachment thumbnails and a failure note", () => {
    render(<InboxTimeline entries={entries} />);
    const img = screen.getByRole("img", { name: "명세서.png" });
    expect(img).toHaveAttribute("src", "https://signed.example/a1");
    expect(screen.getByText("깨짐.png (링크 생성 실패)")).toBeInTheDocument();
  });

  it("labels an automatic reply so staff do not mistake it for their own", () => {
    render(
      <InboxTimeline
        entries={[{ kind: "outbound", id: "m-auto", at: "2026-09-03T01:13:00.000Z", author: null, body: "접수되었습니다", auto: true }]}
      />
    );
    expect(screen.getByText("자동 발송")).toBeInTheDocument();
    expect(screen.getByText("THE PLAY+ 자동 답변")).toBeInTheDocument();
    expect(screen.queryByText("이메일 발송")).not.toBeInTheDocument();
  });

  it("falls back to 사용자 when the inquiry has no account", () => {
    const inquiry = entries[0];
    if (inquiry.kind !== "inquiry") throw new Error("fixture");
    render(<InboxTimeline entries={[{ ...inquiry, author: null, attachments: [] }]} />);
    expect(screen.getByText("사용자")).toBeInTheDocument();
  });
});
