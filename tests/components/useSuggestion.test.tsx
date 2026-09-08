// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSuggestion } from "@/components/inquiries/useSuggestion";

type Event =
  | { type: "text"; text: string }
  | { type: "warning"; reason: string; sourceTitle?: string }
  | { type: "error"; reason: string };

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

function mockStream(events: Event[]) {
  global.fetch = vi.fn().mockResolvedValue(ndjsonResponse(events)) as never;
}

/** 훅의 상태를 화면에 그대로 찍는 하네스. 버튼으로 start/stop/reset을 부른다. */
function Harness({ draft = "" }: { draft?: string }) {
  const s = useSuggestion("inq-1");
  return (
    <div>
      <output data-testid="status">{s.status}</output>
      <output data-testid="text">{s.text}</output>
      <output data-testid="error">{s.error ?? ""}</output>
      <ul data-testid="warnings">{s.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      <ul data-testid="evidence">{s.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
      <button onClick={() => s.start(draft)}>start</button>
      <button onClick={s.stop}>stop</button>
      <button onClick={s.reset}>reset</button>
    </div>
  );
}

const FULL = "안녕하세요, 확인 후 안내드리겠습니다.";

describe("useSuggestion", () => {
  beforeEach(() => {
    mockStream([{ type: "text", text: "안녕하세요, " }, { type: "text", text: "확인 후 안내드리겠습니다." }]);
  });

  it("posts the draft and streams the text, ending in done", async () => {
    render(<Harness draft="확인해 보니 누락분 지급했습니다" />);
    expect(screen.getByTestId("status")).toHaveTextContent("idle");

    await userEvent.click(screen.getByText("start"));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    expect(screen.getByTestId("text")).toHaveTextContent(FULL);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/inquiries/inq-1/suggest");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ draft: "확인해 보니 누락분 지급했습니다" });
  });

  it("shows partial text while streaming", async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body }) as never;
    render(<Harness />);

    await userEvent.click(screen.getByText("start"));
    controller.enqueue(encoder.encode(JSON.stringify({ type: "text", text: "안녕하세요, " }) + "\n"));

    await waitFor(() => expect(screen.getByTestId("text")).toHaveTextContent("안녕하세요,"));
    expect(screen.getByTestId("status")).toHaveTextContent("streaming");

    controller.enqueue(encoder.encode(JSON.stringify({ type: "text", text: "확인 후 안내드리겠습니다." }) + "\n"));
    controller.close();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
  });

  it("trims surrounding whitespace once the stream finishes", async () => {
    mockStream([{ type: "text", text: "  본문 " }, { type: "text", text: "끝  \n" }]);
    render(<Harness />);
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    expect(screen.getByTestId("text").textContent).toBe("본문 끝");
  });

  it("keeps the evidence apart from the text and never shows the delimiter", async () => {
    mockStream([
      { type: "text", text: `${FULL}\n` },
      { type: "text", text: "=== 근거 ===\n- VIP 시트 VIP 탭 7행\n- 과거 답변 R-20260902-0001" },
    ]);
    render(<Harness />);
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    expect(screen.getByTestId("text").textContent).toBe(FULL);
    expect(screen.getByTestId("evidence")).toHaveTextContent("VIP 시트 VIP 탭 7행");
    expect(screen.getByTestId("evidence")).toHaveTextContent("과거 답변 R-20260902-0001");
  });

  it("treats '없음' as no evidence", async () => {
    mockStream([{ type: "text", text: `${FULL}\n=== 근거 ===\n없음` }]);
    render(<Harness />);
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    expect(screen.getByTestId("evidence")).toBeEmptyDOMElement();
  });

  it("collects warnings in order and clears them on the next start", async () => {
    mockStream([
      { type: "warning", reason: "sources_unavailable", sourceTitle: "VIP 원장" },
      { type: "warning", reason: "similar_unavailable" },
      { type: "text", text: FULL },
    ]);
    render(<Harness />);
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    const items = screen.getByTestId("warnings").querySelectorAll("li");
    expect(items[0]).toHaveTextContent("운영 자료를 읽지 못해 자료 없이 작성했습니다. (자료: VIP 원장)");
    expect(items[1]).toHaveTextContent("유사 문의 검색이 안 돼 같은 유형의 최근 답변만 참고했습니다.");

    mockStream([{ type: "text", text: FULL }]);
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    expect(screen.getByTestId("warnings")).toBeEmptyDOMElement();
  });

  it("names the missing API key", async () => {
    mockStream([{ type: "error", reason: "not_configured" }]);
    render(<Harness />);
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    expect(screen.getByTestId("error")).toHaveTextContent("OPENAI_API_KEY가 설정되지 않았습니다.");
  });

  it("distinguishes a safety refusal", async () => {
    mockStream([{ type: "error", reason: "refused" }]);
    render(<Harness />);
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("안전 필터에 걸려 추천을 만들지 못했습니다."));
  });

  it("keeps partial text when the stream fails midway", async () => {
    mockStream([{ type: "text", text: "앞부분입니다." }, { type: "error", reason: "failed" }]);
    render(<Harness />);
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    expect(screen.getByTestId("text")).toHaveTextContent("앞부분입니다.");
    expect(screen.getByTestId("error")).toHaveTextContent("추천 생성에 실패했습니다.");
  });

  it("reads a JSON error body when the route rejects before streaming", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, body: null, json: () => Promise.resolve({ error: "not_found" }) }) as never;
    render(<Harness />);
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("문의를 찾을 수 없습니다."));
  });

  it("reports a thrown request as a generic failure and allows another try", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as never;
    render(<Harness />);
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("추천 생성에 실패했습니다."));

    mockStream([{ type: "text", text: FULL }]);
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
  });

  it("stop aborts the request and keeps what arrived, ending in stopped", async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let signal: AbortSignal | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
        cancel() {},
      });
      return Promise.resolve({ ok: true, status: 200, body });
    }) as never;
    render(<Harness />);

    await userEvent.click(screen.getByText("start"));
    controller.enqueue(encoder.encode(JSON.stringify({ type: "text", text: "여기까지 " }) + "\n"));
    await waitFor(() => expect(screen.getByTestId("text")).toHaveTextContent("여기까지"));

    await userEvent.click(screen.getByText("stop"));

    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("stopped"));
    expect(screen.getByTestId("text").textContent).toBe("여기까지");
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
  });

  it("reset returns to idle and clears everything", async () => {
    mockStream([{ type: "warning", reason: "similar_unavailable" }, { type: "text", text: `${FULL}\n=== 근거 ===\n- VIP 시트 VIP 탭 7행` }]);
    render(<Harness />);
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("done"));

    await userEvent.click(screen.getByText("reset"));

    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(screen.getByTestId("text")).toBeEmptyDOMElement();
    expect(screen.getByTestId("evidence")).toBeEmptyDOMElement();
    expect(screen.getByTestId("warnings")).toBeEmptyDOMElement();
  });
});
