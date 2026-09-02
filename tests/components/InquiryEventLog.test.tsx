// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryEventLog from "@/components/inquiries/InquiryEventLog";
import type { EventRow } from "@/lib/events";

const events: EventRow[] = [
  {
    id: "evt-2",
    actorEmail: "info@theplayplus.com",
    kind: "reply_sent",
    fromValue: null,
    toValue: null,
    createdAt: "2026-09-02T05:00:00.000Z",
  },
  {
    id: "evt-1",
    actorEmail: "info@theplayplus.com",
    kind: "status_changed",
    fromValue: "new",
    toValue: "resolved",
    createdAt: "2026-09-02T04:00:00.000Z",
  },
];

describe("InquiryEventLog", () => {
  it("renders each event with a Korean description and the actor id part", () => {
    render(<InquiryEventLog events={events} createdAt="2026-09-02T03:00:00.000Z" />);
    expect(screen.getByText("변경 이력")).toBeInTheDocument();
    expect(screen.getByText("답변 발송")).toBeInTheDocument();
    expect(screen.getByText("상태 접수 → 완료")).toBeInTheDocument();
    expect(screen.getAllByText("info").length).toBeGreaterThan(0);
  });

  it("appends a synthesized 접수 entry at the end", () => {
    render(<InquiryEventLog events={events} createdAt="2026-09-02T03:00:00.000Z" />);
    const items = screen.getAllByRole("listitem");
    expect(items[items.length - 1].textContent).toContain("접수");
  });

  it("shows the 접수 entry even with no recorded events", () => {
    render(<InquiryEventLog events={[]} createdAt="2026-09-02T03:00:00.000Z" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("접수");
    expect(items[0].textContent).toContain("사용자");
  });
});
