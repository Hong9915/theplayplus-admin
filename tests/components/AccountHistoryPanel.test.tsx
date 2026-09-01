// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AccountHistoryPanel from "@/components/inquiries/AccountHistoryPanel";
import type { AccountHistoryEntry } from "@/lib/account-history";

describe("AccountHistoryPanel", () => {
  it("shows a message when there is no game account on this inquiry", () => {
    render(<AccountHistoryPanel history={[]} gameAccount={null} />);
    expect(screen.getByText("게임 계정 정보가 없어 이력을 조회할 수 없습니다.")).toBeInTheDocument();
  });

  it("shows an empty-history message when the account has no past inquiries", () => {
    render(<AccountHistoryPanel history={[]} gameAccount="player1" />);
    expect(screen.getByText("이전 문의 이력이 없습니다.")).toBeInTheDocument();
  });

  it("lists past inquiries for the account", () => {
    const history: AccountHistoryEntry[] = [
      { id: "inq-2", title: "이전 문의", status: "resolved", groupKey: "game_usage", typeKey: "account_login", createdAt: "2025-06-01T00:00:00.000Z" },
    ];
    render(<AccountHistoryPanel history={history} gameAccount="player1" />);
    expect(screen.getByText("이전 문의")).toBeInTheDocument();
  });

  it("always shows the event-participation extension placeholder", () => {
    render(<AccountHistoryPanel history={[]} gameAccount="player1" />);
    expect(screen.getByText("이벤트 참여 이력 (준비 중)")).toBeInTheDocument();
  });
});
