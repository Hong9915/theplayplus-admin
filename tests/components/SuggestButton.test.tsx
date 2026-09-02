// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SuggestButton from "@/components/inquiries/SuggestButton";

function mockFetchOnce(payload: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve(payload) }) as never;
}

describe("SuggestButton", () => {
  beforeEach(() => {
    mockFetchOnce({ success: true, suggestion: "안녕하세요, 확인 후 안내드리겠습니다." });
  });

  it("requests a suggestion and shows it as a preview without applying it", async () => {
    const onApply = vi.fn();
    render(<SuggestButton inquiryId="inq-1" onApply={onApply} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/suggest",
      expect.objectContaining({ method: "POST" })
    );
    expect(await screen.findByText("안녕하세요, 확인 후 안내드리겠습니다.")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("applies the suggestion and closes the preview", async () => {
    const onApply = vi.fn();
    render(<SuggestButton inquiryId="inq-1" onApply={onApply} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
    await userEvent.click(await screen.findByRole("button", { name: "적용" }));

    expect(onApply).toHaveBeenCalledWith("안녕하세요, 확인 후 안내드리겠습니다.");
    expect(screen.queryByText("안녕하세요, 확인 후 안내드리겠습니다.")).not.toBeInTheDocument();
  });

  it("discards the suggestion without applying it", async () => {
    const onApply = vi.fn();
    render(<SuggestButton inquiryId="inq-1" onApply={onApply} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
    await userEvent.click(await screen.findByRole("button", { name: "버리기" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText("안녕하세요, 확인 후 안내드리겠습니다.")).not.toBeInTheDocument();
  });

  it("tells the admin the API key is missing", async () => {
    mockFetchOnce({ success: false, error: "not_configured" });
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText(/GEMINI_API_KEY/)).toBeInTheDocument();
  });

  it("distinguishes a safety refusal from a generic failure", async () => {
    mockFetchOnce({ success: false, error: "refused" });
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText(/안전 필터/)).toBeInTheDocument();
  });

  it("falls back to a generic message for an unknown error", async () => {
    mockFetchOnce({ success: false, error: "failed" });
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText("추천 생성에 실패했습니다.")).toBeInTheDocument();
  });

  it("shows an error when the request throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as never;
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText("추천 생성에 실패했습니다.")).toBeInTheDocument();
    // 실패해도 다시 시도할 수 있어야 한다.
    expect(screen.getByRole("button", { name: "AI 답변 추천" })).not.toBeDisabled();
  });
});
