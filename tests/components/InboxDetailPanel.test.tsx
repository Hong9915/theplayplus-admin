// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InboxDetailPanel from "@/components/inbox/InboxDetailPanel";
import type { InquiryRow } from "@/lib/inquiries";
import type { EventRow } from "@/lib/events";
import type { AccountHistoryEntry } from "@/lib/account-history";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const inquiry: InquiryRow = {
  id: "inq-1",
  inquiryNo: "R-20260903-0007",
  gameId: "game-1",
  groupKey: "game_usage",
  typeKey: "payment_refund",
  gameAccount: "luna_park",
  companyName: null,
  replyEmail: "luna@example.com",
  title: "중복 결제",
  content: "본문",
  status: "in_progress",
  priority: "high",
  meta: { device: "iPhone 15" },
  draftReply: null,
  replyContent: null,
  repliedAt: null,
  gmailThreadId: null,
  locale: null,
  paymentNo: null,
  occurredAt: null,
  deviceInfo: null,
  createdAt: "2026-09-03T01:12:00.000Z",
};

const events: EventRow[] = [
  { id: "e2", actorEmail: "hong@theplayplus.com", kind: "reply_sent", fromValue: null, toValue: null, createdAt: "2026-09-03T02:05:00.000Z" },
  { id: "e1", actorEmail: "hong@theplayplus.com", kind: "priority_changed", fromValue: "normal", toValue: "high", createdAt: "2026-09-03T01:38:00.000Z" },
];

const history: AccountHistoryEntry[] = [
  { id: "inq-0", inquiryNo: null, title: "예전 문의", content: "…", status: "resolved", groupKey: "game_usage", typeKey: "payment_refund", createdAt: "2026-07-21T00:00:00.000Z" },
];

describe("InboxDetailPanel", () => {
  it("shows processing controls, meta rows, and the event log on the 상세 tab", () => {
    render(<InboxDetailPanel inquiry={inquiry} events={events} history={history} />);
    expect(screen.getByLabelText("상태")).toHaveValue("in_progress");
    expect(screen.getByLabelText("우선순위")).toHaveValue("high");
    expect(screen.getByText("게임 계정")).toBeInTheDocument();
    expect(screen.getByText("luna_park")).toBeInTheDocument();
    expect(screen.getByText("iPhone 15")).toBeInTheDocument();
    expect(screen.getByText("답변 발송")).toBeInTheDocument();
    expect(screen.getByText("우선순위 보통 → 높음")).toBeInTheDocument();
    // 상태 셀렉트의 <option>접수</option>과 구분하기 위해 span만 본다.
    expect(screen.getByText("접수", { selector: "span" })).toBeInTheDocument();
  });

  it("switches to the account history tab and shows the count", async () => {
    render(<InboxDetailPanel inquiry={inquiry} events={events} history={history} />);
    const tab = screen.getByRole("tab", { name: /계정 이력/ });
    expect(tab).toHaveTextContent("1");
    await userEvent.click(tab);
    expect(screen.getByRole("link", { name: /예전 문의/ })).toHaveAttribute("href", "/games/game-1/inquiries/inq-0");
    expect(screen.queryByText("접수 정보")).not.toBeInTheDocument();
  });
});
