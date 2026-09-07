// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConversationSidebar from "@/components/assistant/ConversationSidebar";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const sources = [
  { id: "s1", gameId: "g1", kind: "sheet" as const, externalId: "1AbC", title: "VIP 원장", createdAt: "" },
  { id: "s2", gameId: "g1", kind: "doc" as const, externalId: "1DoC", title: "운영 가이드", createdAt: "" },
];

function renderSidebar(overrides: Partial<React.ComponentProps<typeof ConversationSidebar>> = {}) {
  return render(
    <ConversationSidebar gameId="g1" gameName="여신 키우기" conversations={[]} selectedId={null} sources={sources} onAddSource={vi.fn()} {...overrides} />
  );
}

describe("ConversationSidebar sources", () => {
  beforeEach(() => {
    refresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("lists each source as a new-tab link with its kind", () => {
    renderSidebar();
    const sheet = screen.getByRole("link", { name: /VIP 원장/ });
    expect(sheet).toHaveAttribute("href", "https://docs.google.com/spreadsheets/d/1AbC/edit");
    expect(sheet).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: /운영 가이드/ })).toHaveAttribute("href", "https://docs.google.com/document/d/1DoC/edit");
    expect(screen.getByLabelText("시트")).toBeInTheDocument();
    expect(screen.getByLabelText("문서")).toBeInTheDocument();
  });

  it("shows an empty note when nothing is linked", () => {
    renderSidebar({ sources: [] });
    expect(screen.getByText("연결된 자료가 없습니다")).toBeInTheDocument();
  });

  it("opens the add dialog from the add button", async () => {
    const onAddSource = vi.fn();
    renderSidebar({ onAddSource });
    await userEvent.click(screen.getByRole("button", { name: "+ 자료 추가" }));
    expect(onAddSource).toHaveBeenCalled();
  });

  it("unlinks a source and refreshes", async () => {
    renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: "운영 가이드 연결 해제" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/games/g1/sources/s2", { method: "DELETE" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("no longer offers the old sheet settings button", () => {
    renderSidebar();
    expect(screen.queryByText(/시트 설정/)).toBeNull();
  });
});
