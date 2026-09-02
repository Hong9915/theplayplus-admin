// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InquiryNotes from "@/components/inquiries/InquiryNotes";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const notes = [
  {
    id: "note-1",
    authorEmail: "info@theplayplus.com",
    content: "결제 로그 확인함",
    createdAt: "2026-09-02T04:00:00.000Z",
  },
];

describe("InquiryNotes", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("shows an empty state when there are no notes", () => {
    render(<InquiryNotes inquiryId="inq-1" notes={[]} />);
    expect(screen.getByText("등록된 메모가 없습니다.")).toBeInTheDocument();
  });

  it("says the notes are staff-only", () => {
    render(<InquiryNotes inquiryId="inq-1" notes={[]} />);
    expect(screen.getByText(/운영자 전용/)).toBeInTheDocument();
  });

  it("renders a note with the author id part", () => {
    render(<InquiryNotes inquiryId="inq-1" notes={notes} />);
    expect(screen.getByText("결제 로그 확인함")).toBeInTheDocument();
    // 전체 이메일은 title 속성으로만 남기고 화면에는 아이디 부분만 찍는다.
    // 정규식 매칭은 span과 부모 p 양쪽에 걸려 "multiple elements"가 되므로
    // title로 정확히 집는다.
    expect(screen.getByTitle("info@theplayplus.com")).toHaveTextContent(/^info$/);
    expect(screen.queryByText(/theplayplus\.com/)).not.toBeInTheDocument();
  });

  it("posts the note and refreshes", async () => {
    render(<InquiryNotes inquiryId="inq-1" notes={[]} />);

    await userEvent.type(screen.getByLabelText("내부 메모"), "환불 처리함");
    await userEvent.click(screen.getByRole("button", { name: "메모 추가" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/notes",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "환불 처리함" }) })
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("keeps the text and shows an error when saving fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<InquiryNotes inquiryId="inq-1" notes={[]} />);

    await userEvent.type(screen.getByLabelText("내부 메모"), "환불 처리함");
    await userEvent.click(screen.getByRole("button", { name: "메모 추가" }));

    expect(await screen.findByText("메모 저장에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("내부 메모")).toHaveValue("환불 처리함");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not submit an empty note", async () => {
    render(<InquiryNotes inquiryId="inq-1" notes={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
