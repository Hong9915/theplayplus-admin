// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import InboxConversation from "@/components/inbox/InboxConversation";
import type { InquiryRow } from "@/lib/inquiries";
import type { TimelineEntry } from "@/lib/timeline";
import { DEFAULT_QUERY } from "@/lib/inquiry-filters";
import { gameScope } from "@/lib/inbox-scope";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/inbox/ReplyComposer", () => ({ default: () => <div data-testid="composer" /> }));

const inquiry: InquiryRow = {
  id: "inq-1",
  inquiryNo: "R-20260903-0007",
  gameId: "g1",
  groupKey: "game_usage",
  typeKey: "payment_refund",
  gameAccount: "luna_park",
  companyName: null,
  replyEmail: "luna@example.com",
  title: "중복 결제 환불 요청드립니다",
  content: "본문",
  status: "in_progress",
  priority: "high",
  meta: {},
  draftReply: null,
  replyContent: null,
  repliedAt: null,
  gmailThreadId: null,
  unreadReplyAt: null,
  locale: null,
  translations: {},
  paymentNo: null,
  occurredAt: null,
  deviceInfo: null,
  createdAt: new Date().toISOString(),
};

const labels = { groupLabels: { game_usage: "게임 이용 문의" }, typeLabels: { payment_refund: "결제/환불" }, typeOrder: ["payment_refund"] };
const entries: TimelineEntry[] = [{ kind: "inquiry", id: "inq-1", at: inquiry.createdAt, author: "luna_park", body: "본문", details: [], attachments: [], translations: {} }];

function renderIt(overrides: Partial<InquiryRow> = {}) {
  return render(
    <InboxConversation scope={gameScope("g1")} inquiry={{ ...inquiry, ...overrides }} labels={labels} query={DEFAULT_QUERY} siblingIds={["x", "inq-1", "y"]} entries={entries} />
  );
}

describe("InboxConversation", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("marks an unread reply as read when the inquiry is opened", async () => {
    renderIt({ unreadReplyAt: "2026-09-07T01:00:00.000Z" });
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/inquiries/inq-1/mark-read", expect.objectContaining({ method: "POST" }))
    );
  });

  it("does not call mark-read when there is nothing unread", () => {
    renderIt();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("renders the header with number, title, badge, category, and prev/next", () => {
    renderIt();
    expect(screen.getByText("R-20260903-0007")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "중복 결제 환불 요청드립니다" })).toBeInTheDocument();
    expect(screen.getByText("처리중")).toBeInTheDocument();
    expect(screen.getByText("게임 이용 문의 · 결제/환불")).toBeInTheDocument();
    expect(screen.getByText(/접수 .* · 경과 0분/)).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "완료로 표시" })).toBeInTheDocument();
    expect(screen.getByTestId("composer")).toBeInTheDocument();
  });

  it("keeps header meta on one line so a narrow column truncates instead of wrapping", () => {
    renderIt();
    const badge = screen.getByText("처리중");
    expect(badge.className).toMatch(/whitespace-nowrap/);
    expect(badge.className).toMatch(/shrink-0/);
    expect(screen.getByText("게임 이용 문의 · 결제/환불").className).toMatch(/truncate/);
    expect(screen.getByText(/접수 .* · 경과 0분/).className).toMatch(/truncate/);
  });

  it("shows 회신 확인 only when there is a Gmail thread", () => {
    renderIt();
    expect(screen.queryByRole("button", { name: /회신 확인/ })).not.toBeInTheDocument();
    renderIt({ gmailThreadId: "t1" });
    expect(screen.getByRole("button", { name: /회신 확인/ })).toBeInTheDocument();
  });
});
