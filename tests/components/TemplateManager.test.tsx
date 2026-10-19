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
  { id: "tpl-1", typeKey: "payment_refund", title: "환불 안내", content: "환불 절차입니다.", autoSend: false },
  { id: "tpl-2", typeKey: null, title: "공용 인사", content: "문의 주셔서 감사합니다.", autoSend: false },
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

    await userEvent.click(screen.getAllByRole("button", { name: "삭제" })[1]);

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

  it("shows which template auto-sends and lets staff turn it on or off", async () => {
    const withAuto = [{ ...templates[0], autoSend: true }, templates[1]];
    render(<TemplateManager gameId="game-1" templates={withAuto} typeLabels={typeLabels} />);
    const list = within(screen.getByRole("list"));

    // 공용이 먼저 나오므로 두 번째 줄이 환불 안내(tpl-1)다.
    const [second, first] = list.getAllByRole("switch", { name: "자동 발송" });
    expect(first).toHaveAttribute("aria-checked", "true");
    expect(second).toHaveAttribute("aria-checked", "false");

    await userEvent.click(first);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/templates/tpl-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ autoSend: false }) })
    );

    await userEvent.click(second);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/templates/tpl-2",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ autoSend: true }) })
    );
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("shows an error when toggling auto send fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<TemplateManager gameId="game-1" templates={templates} typeLabels={typeLabels} />);

    await userEvent.click(screen.getAllByRole("switch", { name: "자동 발송" })[0]);

    expect(await screen.findByText("자동 발송 설정에 실패했습니다.")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("edits a template inline and saves title, content, and type", async () => {
    render(<TemplateManager gameId="game-1" templates={templates} typeLabels={typeLabels} />);
    const list = within(screen.getByRole("list"));

    await userEvent.click(list.getAllByRole("button", { name: "수정" })[1]);

    // 기존 값이 채워진 편집 폼이 그 자리에 뜬다.
    const title = list.getByLabelText("템플릿 제목");
    const content = list.getByLabelText("템플릿 내용");
    expect(title).toHaveValue("환불 안내");
    expect(content).toHaveValue("환불 절차입니다.");

    await userEvent.clear(title);
    await userEvent.type(title, "환불 안내 (수정)");
    await userEvent.clear(content);
    await userEvent.type(content, "새 절차입니다.");
    await userEvent.selectOptions(list.getByLabelText("적용 유형"), "bug_report");
    await userEvent.click(list.getByRole("button", { name: "저장" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/templates/tpl-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "환불 안내 (수정)", content: "새 절차입니다.", typeKey: "bug_report" }),
      })
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("cancels an edit without saving", async () => {
    render(<TemplateManager gameId="game-1" templates={templates} typeLabels={typeLabels} />);
    const list = within(screen.getByRole("list"));

    await userEvent.click(list.getAllByRole("button", { name: "수정" })[1]);
    await userEvent.type(list.getByLabelText("템플릿 제목"), " 변경");
    await userEvent.click(list.getByRole("button", { name: "취소" }));

    expect(list.queryByLabelText("템플릿 제목")).not.toBeInTheDocument();
    expect(list.getByText("환불 안내")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not save an edit with a blank title and shows an error when saving fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<TemplateManager gameId="game-1" templates={templates} typeLabels={typeLabels} />);
    const list = within(screen.getByRole("list"));

    await userEvent.click(list.getAllByRole("button", { name: "수정" })[1]);
    await userEvent.clear(list.getByLabelText("템플릿 제목"));
    await userEvent.click(list.getByRole("button", { name: "저장" }));
    expect(global.fetch).not.toHaveBeenCalled();

    await userEvent.type(list.getByLabelText("템플릿 제목"), "제목");
    await userEvent.click(list.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("템플릿 수정에 실패했습니다.")).toBeInTheDocument();
    // 실패해도 편집 중인 내용은 남는다.
    expect(list.getByLabelText("템플릿 제목")).toHaveValue("제목");
  });

  it("cancels the delete when 아니오 is chosen", async () => {
    render(<TemplateManager gameId="game-1" templates={templates} typeLabels={typeLabels} />);

    await userEvent.click(screen.getAllByRole("button", { name: "삭제" })[1]);
    await userEvent.click(screen.getByRole("button", { name: "아니오" }));

    expect(screen.queryByText("삭제할까요?")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps the add form behind 새 템플릿 once there are templates", async () => {
    render(<TemplateManager gameId="game-1" templates={templates} typeLabels={typeLabels} />);
    expect(screen.queryByRole("button", { name: "템플릿 추가" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "새 템플릿" }));
    expect(screen.getByRole("button", { name: "템플릿 추가" })).toBeInTheDocument();
  });

  it("lists shared templates first, then by type order", () => {
    const mixed = [
      { id: "a", typeKey: "bug_report", title: "버그 접수", content: "x", autoSend: false },
      { id: "b", typeKey: "payment_refund", title: "환불", content: "x", autoSend: false },
      { id: "c", typeKey: null, title: "인사", content: "x", autoSend: false },
    ];
    render(<TemplateManager gameId="game-1" templates={mixed} typeLabels={typeLabels} />);
    const titles = within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent);
    expect(titles).toEqual(["인사", "환불", "버그 접수"]);
  });
});
