// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InboxDetailPanel from "@/components/inbox/InboxDetailPanel";
import type { InquiryRow } from "@/lib/inquiries";
import type { EventRow } from "@/lib/events";
import type { AccountHistoryEntry } from "@/lib/account-history";

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => searchParams,
}));

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
  translations: {},
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
  { id: "inq-0", inquiryNo: null, title: "예전 문의", content: "…", status: "resolved", groupKey: "game_usage", typeKey: "payment_refund", occurredAt: null, paymentNo: null, deviceInfo: null, translations: {}, createdAt: "2026-07-21T00:00:00.000Z" },
];

describe("InboxDetailPanel", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    window.history.replaceState(null, "", "/games/game-1/inquiries/inq-1");
  });

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

  it("hides the account history tab entirely when history is null (service inquiries)", () => {
    render(<InboxDetailPanel inquiry={{ ...inquiry, gameAccount: null, companyName: "플레이컴퍼니" }} events={events} history={null} />);
    expect(screen.queryByRole("tab", { name: /계정 이력/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("접수 정보")).toBeInTheDocument();
    expect(screen.getByText("회사명")).toBeInTheDocument();
    expect(screen.getByText("플레이컴퍼니")).toBeInTheDocument();
    expect(screen.queryByText("게임 계정")).not.toBeInTheDocument();
  });
  it("opens on the history tab when the URL says ?tab=history", () => {
    searchParams = new URLSearchParams("tab=history");
    render(<InboxDetailPanel inquiry={inquiry} events={events} history={history} />);
    expect(screen.getByRole("tab", { name: /계정 이력/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("link", { name: /예전 문의/ })).toBeInTheDocument();
  });

  it("writes the open tab into the URL without a navigation", async () => {
    render(<InboxDetailPanel inquiry={inquiry} events={events} history={history} />);
    await userEvent.click(screen.getByRole("tab", { name: /계정 이력/ }));
    expect(window.location.search).toBe("?tab=history");
    await userEvent.click(screen.getByRole("tab", { name: "상세" }));
    expect(window.location.search).toBe("");
  });

  it("moves between tabs with the arrow keys and keeps only the active tab in the Tab order", async () => {
    render(<InboxDetailPanel inquiry={inquiry} events={events} history={history} />);
    const detail = screen.getByRole("tab", { name: "상세" });
    const historyTab = screen.getByRole("tab", { name: /계정 이력/ });
    expect(detail).toHaveAttribute("tabindex", "0");
    expect(historyTab).toHaveAttribute("tabindex", "-1");

    detail.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(historyTab).toHaveAttribute("aria-selected", "true");
    expect(historyTab).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", historyTab.id);
    expect(historyTab).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
  });
});
