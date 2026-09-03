// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReplyComposer from "@/components/inbox/ReplyComposer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/inquiries/ReplyForm", () => ({ default: () => <div data-testid="reply-form" /> }));
vi.mock("@/components/inbox/NoteForm", () => ({ default: () => <div data-testid="note-form" /> }));

describe("ReplyComposer", () => {
  function renderIt() {
    return render(<ReplyComposer inquiryId="inq-1" replyEmail="user@example.com" initialDraft={null} templates={[]} typeKey="bug_report" />);
  }

  it("starts on the reply tab and shows the recipient", () => {
    renderIt();
    expect(screen.getByTestId("reply-form")).toBeInTheDocument();
    expect(screen.queryByTestId("note-form")).not.toBeInTheDocument();
    expect(screen.getByText("받는 사람 user@example.com")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "답변" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the note tab", async () => {
    renderIt();
    await userEvent.click(screen.getByRole("tab", { name: "내부 메모" }));
    expect(screen.getByTestId("note-form")).toBeInTheDocument();
    expect(screen.queryByTestId("reply-form")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "내부 메모" })).toHaveAttribute("aria-selected", "true");
  });
});
