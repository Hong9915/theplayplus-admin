// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
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
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} templates={[]} typeKey="payment_refund" />);

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
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} templates={[]} typeKey="payment_refund" />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "확인 후 조치하겠습니다");
    await userEvent.click(screen.getByRole("button", { name: "답변 발송" }));

    expect(await screen.findByText("발송 실패, 다시 시도해주세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("답변 내용")).toHaveValue("확인 후 조치하겠습니다");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("keeps the typed content and shows an error when the request throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as never;
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} templates={[]} typeKey="payment_refund" />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "확인 후 조치하겠습니다");
    const button = screen.getByRole("button", { name: "답변 발송" });
    await userEvent.click(button);

    expect(await screen.findByText("발송 실패, 다시 시도해주세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("답변 내용")).toHaveValue("확인 후 조치하겠습니다");
    expect(button).not.toBeDisabled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("gives the textarea room for a full reply", () => {
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} templates={[]} typeKey="general" />);
    const textarea = screen.getByLabelText("답변 내용");
    expect(textarea).toHaveAttribute("rows", "12");
    expect(textarea.className).toContain("resize-y");
  });

  it("prefills the textarea with an existing draft", () => {
    render(<ReplyForm inquiryId="inq-1" initialDraft="작성하던 답변" templates={[]} typeKey="payment_refund" />);
    expect(screen.getByLabelText("답변 내용")).toHaveValue("작성하던 답변");
  });

  it("saves the draft without sending", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} templates={[]} typeKey="payment_refund" />);

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
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} templates={[]} typeKey="payment_refund" />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "나중에 이어서");
    await userEvent.click(screen.getByRole("button", { name: "초안 저장" }));

    expect(await screen.findByText("초안 저장에 실패했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("답변 내용")).toHaveValue("나중에 이어서");
  });

  const templates = [
    { id: "tpl-1", typeKey: "payment_refund", title: "환불 안내", content: "환불 절차입니다.", autoSend: false },
  ];

  it("does not render the template picker when no template applies", () => {
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} templates={[]} typeKey="payment_refund" />);
    expect(screen.queryByLabelText("템플릿 선택")).not.toBeInTheDocument();
  });

  it("fills an empty textarea straight from a template", async () => {
    render(
      <ReplyForm inquiryId="inq-1" initialDraft={null} templates={templates} typeKey="payment_refund" />
    );

    await userEvent.selectOptions(screen.getByLabelText("템플릿 선택"), "tpl-1");

    expect(screen.getByLabelText("답변 내용")).toHaveValue("환불 절차입니다.");
  });

  it("warns before replacing text the admin already wrote, then replaces on the second pick", async () => {
    render(
      <ReplyForm
        inquiryId="inq-1"
        initialDraft="직접 쓰던 답변"
        templates={templates}
        typeKey="payment_refund"
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("템플릿 선택"), "tpl-1");

    expect(screen.getByText(/한 번 더 선택하면 대체됩니다/)).toBeInTheDocument();
    expect(screen.getByLabelText("답변 내용")).toHaveValue("직접 쓰던 답변");

    await userEvent.selectOptions(screen.getByLabelText("템플릿 선택"), "tpl-1");

    expect(screen.getByLabelText("답변 내용")).toHaveValue("환불 절차입니다.");
  });

  it("sends what the admin has typed so far when asking for an AI suggestion", async () => {
    const encoder = new TextEncoder();
    const stream = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(JSON.stringify({ type: "text", text: "완성된 답변" }) + "\n"));
          controller.close();
        },
      });
    global.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith("/suggest")
          ? { ok: true, status: 200, body: stream() }
          : { ok: true, json: () => Promise.resolve({ success: true }) }
      )
    ) as never;
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} templates={[]} typeKey="payment_refund" autosaveDelayMs={60_000} />);

    await userEvent.type(screen.getByRole("textbox"), "누락분 지급했습니다");
    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    const call = vi.mocked(global.fetch).mock.calls.find(([url]) => String(url).endsWith("/suggest"));
    expect(call).toBeDefined();
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ draft: "누락분 지급했습니다" });
    expect(await screen.findByText("완성된 답변")).toBeInTheDocument();
  });

  it("submits with Cmd+Enter from the textarea", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} templates={[]} typeKey="payment_refund" />);

    const textarea = screen.getByLabelText("답변 내용");
    await userEvent.type(textarea, "단축키로 보냅니다");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/inquiries/inq-1/reply",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ replyContent: "단축키로 보냅니다" }) })
      )
    );
  });

  it("does not submit on a plain Enter", async () => {
    global.fetch = vi.fn() as never;
    render(<ReplyForm inquiryId="inq-1" initialDraft={null} templates={[]} typeKey="payment_refund" />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "첫 줄{Enter}둘째 줄");

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("답변 내용")).toHaveValue("첫 줄\n둘째 줄");
  });

  describe("autosave", () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    it("saves the draft quietly after typing pauses", async () => {
      global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
      render(
        <ReplyForm inquiryId="inq-1" initialDraft={null} templates={[]} typeKey="payment_refund" autosaveDelayMs={50} />
      );

      await userEvent.type(screen.getByLabelText("답변 내용"), "자동 저장");
      expect(global.fetch).not.toHaveBeenCalled();

      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/inquiries/inq-1/draft",
          expect.objectContaining({ method: "PUT", body: JSON.stringify({ draftReply: "자동 저장" }) })
        )
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(await screen.findByText(/초안 자동 저장됨/)).toBeInTheDocument();
    });

    it("does not save an untouched prefilled draft", async () => {
      global.fetch = vi.fn() as never;
      render(
        <ReplyForm inquiryId="inq-1" initialDraft="이미 저장된 초안" templates={[]} typeKey="payment_refund" autosaveDelayMs={20} />
      );

      await act(() => sleep(80));

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("does not resave the same text twice", async () => {
      global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
      render(
        <ReplyForm inquiryId="inq-1" initialDraft={null} templates={[]} typeKey="payment_refund" autosaveDelayMs={30} />
      );

      await userEvent.type(screen.getByLabelText("답변 내용"), "한 번만");
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
      await act(() => sleep(120));

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
