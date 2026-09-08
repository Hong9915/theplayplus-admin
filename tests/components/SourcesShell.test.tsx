// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SourcesShell from "@/components/assistant/SourcesShell";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh, push: vi.fn() }) }));

const game = { id: "g1", name: "여신 키우기" };
const sources = [
  { id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "1AbC", title: "VIP 원장", createdAt: "" },
  { id: "s2", gameId: "g1", kind: "doc" as const, externalId: "2DeF", title: "운영 가이드", createdAt: "" },
];

describe("SourcesShell", () => {
  beforeEach(() => {
    refresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("shows the game, the linked sources, and the service account to share with — no chat", () => {
    render(<SourcesShell game={game} sources={sources} serviceAccountEmail="bot@proj.iam.gserviceaccount.com" />);

    expect(screen.getByRole("heading", { name: "여신 키우기" })).toBeInTheDocument();
    expect(screen.getByText("운영 자료")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /VIP 원장/ })).toHaveAttribute("href", expect.stringContaining("1AbC"));
    expect(screen.getByRole("link", { name: /운영 가이드/ })).toHaveAttribute("href", expect.stringContaining("2DeF"));
    expect(screen.getByText("bot@proj.iam.gserviceaccount.com")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/새 대화/)).not.toBeInTheDocument();
  });

  it("opens the add dialog from + 자료 추가", async () => {
    render(<SourcesShell game={game} sources={[]} serviceAccountEmail={null} />);

    expect(screen.getByText("연결된 자료가 없습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ 자료 추가" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("unlinks a source and refreshes", async () => {
    render(<SourcesShell game={game} sources={sources} serviceAccountEmail={null} />);

    await userEvent.click(screen.getByRole("button", { name: "VIP 원장 연결 해제" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/games/g1/sources/s1", { method: "DELETE" });
    expect(refresh).toHaveBeenCalled();
  });
});
