// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import InboxConversation from "@/components/inbox/InboxConversation";
import type { InquiryRow } from "@/lib/inquiries";
import type { TimelineEntry } from "@/lib/timeline";
import { DEFAULT_QUERY } from "@/lib/inquiry-filters";

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
  locale: null,
  paymentNo: null,
  occurredAt: null,
  deviceInfo: null,
  createdAt: new Date().toISOString(),
};

const labels = { groupLabels: { game_usage: "게임 이용 문의" }, typeLabels: { payment_refund: "결제/환불" }, typeOrder: ["payment_refund"] };
const entries: TimelineEntry[] = [{ kind: "inquiry", id: "inq-1", at: inquiry.createdAt, author: "luna_park", body: "본문", attachments: [] }];

function renderIt(overrides: Partial<InquiryRow> = {}) {
  return render(
    <InboxConversation gameId="g1" inquiry={{ ...inquiry, ...overrides }} labels={labels} query={DEFAULT_QUERY} siblingIds={["x", "inq-1", "y"]} entries={entries} templates={[]} />
  );
}

describe("InboxConversation", () => {
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

  it("shows 회신 확인 only when there is a Gmail thread", () => {
    renderIt();
    expect(screen.queryByRole("button", { name: /회신 확인/ })).not.toBeInTheDocument();
    renderIt({ gmailThreadId: "t1" });
    expect(screen.getByRole("button", { name: /회신 확인/ })).toBeInTheDocument();
  });
});
