// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TemplateManager from "@/components/templates/TemplateManager";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const typeLabels = { payment_refund: "결제/환불", bug_report: "버그·오류 신고" };

const templates = [
  { id: "tpl-1", typeKey: "payment_refund", title: "환불 안내", content: "환불 절차입니다." },
  { id: "tpl-2", typeKey: null, title: "공용 인사", content: "문의 주셔서 감사합니다." },
];

describe("TemplateManager", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("shows an empty state when there are no templates", () => {
    render(<TemplateManager gameId="game-1" templates={[]} typeLabels={typeLabels} />);
    expect(screen.getByText("등록된 템플릿이 없습니다.")).toBeInTheDocument();
  });

  it("lists templates with their type label, and 공용 for shared ones", () => {
    render(<TemplateManager gameId="game-1" templates={templates} typeLabels={typeLabels} />);
    // 유형 라벨은 추가 폼의 <option>에도 있으므로 목록으로 범위를 좁힌다.
    const list = within(screen.getByRole("list"));
    expect(list.getByText("환불 안내")).toBeInTheDocument();
    expect(list.getByText("결제/환불")).toBeInTheDocument();
    expect(list.getByText("공용 인사")).toBeInTheDocument();
    expect(list.getByText("공용")).toBeInTheDocument();
  });

  it("posts a new template and refreshes", async () => {
    render(<TemplateManager gameId="game-1" templates={[]} typeLabels={typeLabels} />);

    await userEvent.type(screen.getByLabelText("템플릿 제목"), "점검 안내");
    await userEvent.type(screen.getByLabelText("템플릿 내용"), "점검이 진행 중입니다.");
    await userEvent.selectOptions(screen.getByLabelText("적용 유형"), "payment_refund");
    await userEvent.click(screen.getByRole("button", { name: "템플릿 추가" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/games/game-1/templates",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          typeKey: "payment_refund",
          title: "점검 안내",
          content: "점검이 진행 중입니다.",
        }),
      })
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("sends a null typeKey when 공용 is selected", async () => {
    render(<TemplateManager gameId="game-1" templates={[]} typeLabels={typeLabels} />);

    await userEvent.type(screen.getByLabelText("템플릿 제목"), "공용");
    await userEvent.type(screen.getByLabelText("템플릿 내용"), "본문");
    await userEvent.click(screen.getByRole("button", { name: "템플릿 추가" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/games/game-1/templates",
      expect.objectContaining({
        body: JSON.stringify({ typeKey: null, title: "공용", content: "본문" }),
      })
    );
  });

  it("does not submit when the title or content is blank", async () => {
    render(<TemplateManager gameId="game-1" templates={[]} typeLabels={typeLabels} />);

    await userEvent.type(screen.getByLabelText("템플릿 제목"), "제목만");
    await userEvent.click(screen.getByRole("button", { name: "템플릿 추가" }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps the input and shows an error when saving fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<TemplateManager gameId="game-1" templates={[]} typeLabels={typeLabels} />);

    await userEvent.type(screen.getByLabelText("템플릿 제목"), "점검 안내");
    await userEvent.type(screen.getByLabelText("템플릿 내용"), "본문");
    await userEvent.click(screen.getByRole("button", { name: "템플릿 추가" }));

    expect(await screen.findByText("템플릿 저장에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("템플릿 제목")).toHaveValue("점검 안내");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("asks for inline confirmation before deleting", async () => {
    render(<TemplateManager gameId="game-1" templates={templates} typeLabels={typeLabels} />);

    await userEvent.click(screen.getAllByRole("button", { name: "삭제" })[0]);

    // 브라우저 confirm()을 쓰지 않는다 — 인라인 2단계 확인.
    expect(screen.getByText("삭제할까요?")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "예" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/templates/tpl-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("cancels the delete when 아니오 is chosen", async () => {
    render(<TemplateManager gameId="game-1" templates={templates} typeLabels={typeLabels} />);

    await userEvent.click(screen.getAllByRole("button", { name: "삭제" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "아니오" }));

    expect(screen.queryByText("삭제할까요?")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
