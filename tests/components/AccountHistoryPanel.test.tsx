// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AccountHistoryPanel from "@/components/inquiries/AccountHistoryPanel";
import type { AccountHistoryEntry } from "@/lib/account-history";

const entry: AccountHistoryEntry = {
  id: "inq-2", inquiryNo: null,
  title: "이전 문의",
  content: "지난주에 결제한 다이아가 아직 안 들어왔습니다. 확인 부탁드립니다.",
  status: "resolved",
  groupKey: "game_usage",
  typeKey: "account_login",
  occurredAt: null,
  paymentNo: null,
  store: null,
  deviceInfo: null,
  translations: {},
  createdAt: "2025-06-01T00:00:00.000Z",
};

describe("AccountHistoryPanel", () => {
  it("shows a message when there is no game account on this inquiry", () => {
    render(<AccountHistoryPanel history={[]} gameAccount={null} gameId="game-1" />);
    expect(screen.getByText("게임 계정 정보가 없어 이력을 조회할 수 없습니다.")).toBeInTheDocument();
  });

  it("shows an empty-history message when the account has no past inquiries", () => {
    render(<AccountHistoryPanel history={[]} gameAccount="player1" gameId="game-1" />);
    expect(screen.getByText("이전 문의 이력이 없습니다.")).toBeInTheDocument();
  });

  it("lists past inquiries with a body preview", () => {
    render(<AccountHistoryPanel history={[entry]} gameAccount="player1" gameId="game-1" />);
    expect(screen.getByText("이전 문의")).toBeInTheDocument();
    expect(screen.getByText(/지난주에 결제한 다이아가/)).toBeInTheDocument();
  });

  it("links each past inquiry to its detail page", () => {
    render(<AccountHistoryPanel history={[entry]} gameAccount="player1" gameId="game-1" />);
    const link = screen.getByRole("link", { name: /이전 문의/ });
    expect(link).toHaveAttribute("href", "/games/game-1/inquiries/inq-2");
  });

  it("shows when each past inquiry was received", () => {
    render(<AccountHistoryPanel history={[entry]} gameAccount="player1" gameId="game-1" />);
    expect(screen.getByText(/2025\. 06\. 01\./)).toBeInTheDocument();
  });

  it("summarises count, unresolved, and same-type inquiries", () => {
    const history: AccountHistoryEntry[] = [
      entry,
      { ...entry, id: "inq-3", status: "new", typeKey: "payment_refund" },
      { ...entry, id: "inq-4", status: "in_progress", typeKey: "account_login" },
    ];
    render(<AccountHistoryPanel history={history} gameAccount="player1" currentTypeKey="account_login" gameId="game-1" />);
    const summary = screen.getByTestId("account-history-summary");
    expect(summary).toHaveTextContent("이전 문의 3건");
    expect(summary).toHaveTextContent("미처리 2건");
    expect(summary).toHaveTextContent("같은 유형 2건");
  });

  it("omits the same-type figure when no current type is given", () => {
    render(<AccountHistoryPanel history={[entry]} gameAccount="player1" gameId="game-1" />);
    const summary = screen.getByTestId("account-history-summary");
    expect(summary).toHaveTextContent("이전 문의 1건");
    expect(summary).not.toHaveTextContent("같은 유형");
  });

  it("shows no summary when there is no history", () => {
    render(<AccountHistoryPanel history={[]} gameAccount="player1" currentTypeKey="x" gameId="game-1" />);
    expect(screen.queryByTestId("account-history-summary")).not.toBeInTheDocument();
  });

  it("always shows the event-participation extension placeholder", () => {
    render(<AccountHistoryPanel history={[]} gameAccount="player1" gameId="game-1" />);
    expect(screen.getByText("이벤트 참여 이력 (준비 중)")).toBeInTheDocument();
  });

  it("drops the card frame when frameless", () => {
    const { container } = render(<AccountHistoryPanel history={[]} gameAccount={null} gameId="game-1" frameless />);
    expect(container.firstElementChild).not.toHaveClass("border");
  });
});
