// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReplyForm from "@/components/inquiries/ReplyForm";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe("ReplyForm", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it("sends the reply and refreshes on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "확인 후 조치하겠습니다");
    await userEvent.click(screen.getByRole("button", { name: "답변 발송" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/reply",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ replyContent: "확인 후 조치하겠습니다" }),
      })
    );
    expect(await screen.findByText("답변이 발송되었습니다.")).toBeInTheDocument();
  });

  it("keeps the typed content and shows an error when sending fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false, error: "send_failed" }) }) as never;
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "확인 후 조치하겠습니다");
    await userEvent.click(screen.getByRole("button", { name: "답변 발송" }));

    expect(await screen.findByText("발송 실패, 다시 시도해주세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("답변 내용")).toHaveValue("확인 후 조치하겠습니다");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("keeps the typed content and shows an error when the request throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as never;
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "확인 후 조치하겠습니다");
    const button = screen.getByRole("button", { name: "답변 발송" });
    await userEvent.click(button);

    expect(await screen.findByText("발송 실패, 다시 시도해주세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("답변 내용")).toHaveValue("확인 후 조치하겠습니다");
    expect(button).not.toBeDisabled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("prefills the textarea with an existing draft", () => {
    render(<ReplyForm inquiryId="inq-1" initialDraft="작성하던 답변" />);
    expect(screen.getByLabelText("답변 내용")).toHaveValue("작성하던 답변");
  });

  it("saves the draft without sending", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "나중에 이어서");
    await userEvent.click(screen.getByRole("button", { name: "초안 저장" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/draft",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ draftReply: "나중에 이어서" }) })
    );
    expect(await screen.findByText("초안을 저장했습니다.")).toBeInTheDocument();
  });

  it("shows an error when saving the draft fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false }) }) as never;
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "나중에 이어서");
    await userEvent.click(screen.getByRole("button", { name: "초안 저장" }));

    expect(await screen.findByText("초안 저장에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("답변 내용")).toHaveValue("나중에 이어서");
  });
});
