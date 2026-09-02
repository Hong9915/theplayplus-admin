// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TemplatePicker from "@/components/inquiries/TemplatePicker";

const templates = [
  { id: "tpl-1", typeKey: "payment_refund", title: "환불 안내", content: "환불 절차입니다." },
  { id: "tpl-2", typeKey: null, title: "공용 인사", content: "문의 주셔서 감사합니다." },
  { id: "tpl-3", typeKey: "bug_report", title: "버그 접수", content: "버그 확인 중입니다." },
];

describe("TemplatePicker", () => {
  it("offers templates for this type plus shared ones, and hides other types", () => {
    render(<TemplatePicker templates={templates} typeKey="payment_refund" onPick={vi.fn()} />);

    expect(screen.getByRole("option", { name: "환불 안내" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "공용 인사" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "버그 접수" })).not.toBeInTheDocument();
  });

  it("calls onPick with the template body", async () => {
    const onPick = vi.fn();
    render(<TemplatePicker templates={templates} typeKey="payment_refund" onPick={onPick} />);

    await userEvent.selectOptions(screen.getByLabelText("템플릿 선택"), "tpl-1");

    expect(onPick).toHaveBeenCalledWith("환불 절차입니다.");
  });

  it("renders nothing when no template applies to this type", () => {
    const { container } = render(
      <TemplatePicker
        templates={[{ id: "tpl-3", typeKey: "bug_report", title: "버그 접수", content: "본문" }]}
        typeKey="payment_refund"
        onPick={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are no templates at all", () => {
    const { container } = render(
      <TemplatePicker templates={[]} typeKey="payment_refund" onPick={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
