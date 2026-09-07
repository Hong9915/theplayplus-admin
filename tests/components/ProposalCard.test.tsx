// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProposalCard from "@/components/assistant/ProposalCard";
import type { ChatMessage } from "@/components/assistant/messages";

const pending: ChatMessage = {
  id: "m1",
  role: "proposal",
  content: "",
  proposal: { kind: "update", sheet: "VIP", row: 7, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] },
  status: "pending",
  failureReason: null,
  appliedBy: null,
  appliedAt: null,
attachments: [],
};

describe("ProposalCard", () => {
  beforeEach(() => {
    global.fetch = vi.fn() as never;
  });

  it("shows the sheet, row, and before/after values with apply and cancel", () => {
    render(<ProposalCard message={pending} onChange={vi.fn()} />);
    expect(screen.getByText("시트 수정 제안")).toBeInTheDocument();
    expect(screen.getByText("VIP")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("VIP 단계")).toBeInTheDocument();
    expect(screen.getByText("VIP3")).toBeInTheDocument();
    expect(screen.getByText("VIP4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "적용" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeEnabled();
  });

  it("renders append proposals as column/value rows", () => {
    render(
      <ProposalCard
        message={{ ...pending, proposal: { kind: "append", sheet: "VIP", values: { 이메일: "c@x.com", "VIP 단계": "VIP1" } } }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText(/행 추가/)).toBeInTheDocument();
    expect(screen.getByText("c@x.com")).toBeInTheDocument();
  });

  it("applies via the API and reports the new status", async () => {
    const onChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, status: "applied", appliedBy: "a@b", appliedAt: "2026-09-04T03:00:00.000Z" }),
    } as never);

    render(<ProposalCard message={pending} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/assistant/messages/m1/apply", { method: "POST" });
    expect(onChange).toHaveBeenCalledWith({ status: "applied", appliedBy: "a@b", appliedAt: "2026-09-04T03:00:00.000Z", failureReason: null });
  });

  it("reports failure reasons", async () => {
    const onChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: false, status: "failed", failureReason: "conflict" }),
    } as never);

    render(<ProposalCard message={pending} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(onChange).toHaveBeenCalledWith({ status: "failed", failureReason: "conflict" });
  });

  it("cancels via the API", async () => {
    const onChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true, status: "cancelled" }) } as never);

    render(<ProposalCard message={pending} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/assistant/messages/m1/cancel", { method: "POST" });
    expect(onChange).toHaveBeenCalledWith({ status: "cancelled" });
  });

  it("shows applied, cancelled, and failed states without buttons", () => {
    const { rerender } = render(<ProposalCard message={{ ...pending, status: "applied", appliedBy: "a@b", appliedAt: "2026-09-04T03:00:00.000Z" }} onChange={vi.fn()} />);
    expect(screen.getByText(/적용됨 · a@b/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<ProposalCard message={{ ...pending, status: "cancelled" }} onChange={vi.fn()} />);
    expect(screen.getByText("취소됨")).toBeInTheDocument();

    rerender(<ProposalCard message={{ ...pending, status: "failed", failureReason: "conflict" }} onChange={vi.fn()} />);
    expect(screen.getByText(/실패/)).toBeInTheDocument();
    expect(screen.getByText(/시트가 그 사이 바뀌었습니다/)).toBeInTheDocument();
  });
});
