// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NoteForm from "@/components/inbox/NoteForm";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("NoteForm", () => {
  beforeEach(() => {
    refresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("says notes are staff-only", () => {
    render(<NoteForm inquiryId="inq-1" />);
    expect(screen.getByText(/운영자 전용/)).toBeInTheDocument();
  });

  it("posts the note, clears the box, and refreshes", async () => {
    render(<NoteForm inquiryId="inq-1" />);
    await userEvent.type(screen.getByLabelText("내부 메모"), "확인함");
    await userEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/notes",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "확인함" }) })
    );
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByLabelText("내부 메모")).toHaveValue("");
  });

  it("does nothing for an empty note", async () => {
    render(<NoteForm inquiryId="inq-1" />);
    await userEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows an error when saving fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<NoteForm inquiryId="inq-1" />);
    await userEvent.type(screen.getByLabelText("내부 메모"), "x");
    await userEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    expect(await screen.findByText("메모 저장에 실패했습니다.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
