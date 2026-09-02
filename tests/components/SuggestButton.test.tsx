// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SuggestButton from "@/components/inquiries/SuggestButton";

type Event = { type: "text"; text: string } | { type: "error"; reason: string };

/** 라우트가 흘려보내는 NDJSON 응답을 흉내 낸다. */
function ndjsonResponse(events: Event[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      controller.close();
    },
  });
  return { ok: true, status: 200, body };
}

function mockStreamOnce(events: Event[]) {
  global.fetch = vi.fn().mockResolvedValue(ndjsonResponse(events)) as never;
}

function mockJsonErrorOnce(status: number, payload: unknown) {
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: false, status, body: null, json: () => Promise.resolve(payload) }) as never;
}

const FULL = "안녕하세요, 확인 후 안내드리겠습니다.";

describe("SuggestButton", () => {
  beforeEach(() => {
    mockStreamOnce([
      { type: "text", text: "안녕하세요, " },
      { type: "text", text: "확인 후 안내드리겠습니다." },
    ]);
  });

  it("requests a suggestion and shows the streamed text as a preview without applying it", async () => {
    const onApply = vi.fn();
    render(<SuggestButton inquiryId="inq-1" onApply={onApply} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/suggest",
      expect.objectContaining({ method: "POST" })
    );
    expect(await screen.findByText(FULL)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("shows partial text while streaming and hides apply/discard until it finishes", async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body }) as never;

    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    controller.enqueue(encoder.encode(JSON.stringify({ type: "text", text: "안녕하세요, " }) + "\n"));

    expect(await screen.findByText(/안녕하세요,/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "적용" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /생성 중/ })).toBeDisabled();

    controller.enqueue(encoder.encode(JSON.stringify({ type: "text", text: "확인 후 안내드리겠습니다." }) + "\n"));
    controller.close();

    expect(await screen.findByRole("button", { name: "적용" })).toBeInTheDocument();
    expect(screen.getByText(FULL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI 답변 추천" })).not.toBeDisabled();
  });

  it("applies the suggestion and closes the preview", async () => {
    const onApply = vi.fn();
    render(<SuggestButton inquiryId="inq-1" onApply={onApply} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
    await userEvent.click(await screen.findByRole("button", { name: "적용" }));

    expect(onApply).toHaveBeenCalledWith(FULL);
    expect(screen.queryByText(FULL)).not.toBeInTheDocument();
  });

  it("trims surrounding whitespace from the finished suggestion", async () => {
    mockStreamOnce([{ type: "text", text: "  본문 " }, { type: "text", text: "끝  \n" }]);
    const onApply = vi.fn();
    render(<SuggestButton inquiryId="inq-1" onApply={onApply} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
    await userEvent.click(await screen.findByRole("button", { name: "적용" }));

    expect(onApply).toHaveBeenCalledWith("본문 끝");
  });

  it("discards the suggestion without applying it", async () => {
    const onApply = vi.fn();
    render(<SuggestButton inquiryId="inq-1" onApply={onApply} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
    await userEvent.click(await screen.findByRole("button", { name: "버리기" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText(FULL)).not.toBeInTheDocument();
  });

  it("tells the admin the API key is missing", async () => {
    mockStreamOnce([{ type: "error", reason: "not_configured" }]);
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText(/GEMINI_API_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "적용" })).not.toBeInTheDocument();
  });

  it("distinguishes a safety refusal from a generic failure", async () => {
    mockStreamOnce([{ type: "error", reason: "refused" }]);
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText(/안전 필터/)).toBeInTheDocument();
  });

  it("keeps partial text usable when the stream fails midway", async () => {
    mockStreamOnce([{ type: "text", text: "앞부분입니다." }, { type: "error", reason: "failed" }]);
    const onApply = vi.fn();
    render(<SuggestButton inquiryId="inq-1" onApply={onApply} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText("추천 생성에 실패했습니다.")).toBeInTheDocument();
    // 이미 받은 부분은 관리자가 살릴 수 있어야 한다.
    await userEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(onApply).toHaveBeenCalledWith("앞부분입니다.");
  });

  it("falls back to a generic message for an unknown error", async () => {
    mockStreamOnce([{ type: "error", reason: "failed" }]);
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText("추천 생성에 실패했습니다.")).toBeInTheDocument();
  });

  it("reads a JSON error body when the route rejects before streaming", async () => {
    mockJsonErrorOnce(404, { success: false, error: "not_found" });
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText("문의를 찾을 수 없습니다.")).toBeInTheDocument();
  });

  it("shows an error when the request throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as never;
    render(<SuggestButton inquiryId="inq-1" onApply={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

    expect(await screen.findByText("추천 생성에 실패했습니다.")).toBeInTheDocument();
    // 실패해도 다시 시도할 수 있어야 한다.
    await waitFor(() => expect(screen.getByRole("button", { name: "AI 답변 추천" })).not.toBeDisabled());
  });
});
