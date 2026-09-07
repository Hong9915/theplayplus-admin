// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPane from "@/components/assistant/ChatPane";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh, push: vi.fn() }) }));

function ndjson(lines: unknown[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      controller.close();
    },
  });
  return { ok: true, body, json: () => Promise.resolve({}) };
}

describe("ChatPane", () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
    global.fetch = vi.fn() as never;
  });

  it("renders existing messages", () => {
    render(
      <ChatPane
        gameId="g1"
        conversationId="c1"
        initialMessages={[
          { id: "m1", role: "user", content: "VIP?", proposal: null, status: null, failureReason: null, appliedBy: null, appliedAt: null, attachments: [] },
          { id: "m2", role: "assistant", content: "VIP3입니다", proposal: null, status: null, failureReason: null, appliedBy: null, appliedAt: null, attachments: [] },
        ]}
      />
    );
    expect(screen.getByText("VIP?")).toBeInTheDocument();
    expect(screen.getByText("VIP3입니다")).toBeInTheDocument();
  });

  it("sends a message and streams the reply into the list", async () => {
    vi.mocked(global.fetch).mockResolvedValue(ndjson([{ type: "text", text: "VIP3" }, { type: "text", text: "입니다" }]) as never);

    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "52009 VIP?");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/assistant/conversations/c1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "52009 VIP?" }),
    });
    expect(screen.getByText("52009 VIP?")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("VIP3입니다")).toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "메시지" })).toHaveValue("");
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the streaming cursor only on the message currently streaming", async () => {
    const firstBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: "text", text: "첫 번째" }) + "\n"));
        controller.close();
      },
    });
    // 두 번째 스트림은 절대 닫히지 않는다 — 전송 중 상태를 계속 붙잡아 둔다.
    const secondBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: "text", text: "두 번째" }) + "\n"));
      },
    });

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, body: firstBody, json: () => Promise.resolve({}) } as never)
      .mockResolvedValueOnce({ ok: true, body: secondBody, json: () => Promise.resolve({}) } as never);

    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);

    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "1");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(screen.getByText("첫 번째")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "메시지" })).not.toBeDisabled());

    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "2");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(screen.getByText("두 번째")).toBeInTheDocument());

    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(1);
  });

  it("creates a conversation first when there is none", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, conversationId: "c9" }) } as never)
      .mockResolvedValueOnce(ndjson([{ type: "text", text: "네" }]) as never);

    render(<ChatPane gameId="g1" conversationId={null} initialMessages={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "안녕");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

    // history.replaceState (not router.replace) keeps the URL in sync without a re-render
    // that would unmount ChatPane mid-stream. See F2 in the final fix review.
    await waitFor(() => expect(replaceState).toHaveBeenCalledWith(null, "", "/games/g1/assistant?c=c9"));
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe("/api/assistant/conversations");
    expect(JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)).toEqual({ gameId: "g1", firstMessage: "안녕" });
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toBe("/api/assistant/conversations/c9/messages");
  });

  it("renders proposals as cards", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      ndjson([{ type: "proposal", messageId: "p1", proposal: { kind: "update", sheet: "VIP", row: 2, updates: [{ column: "VIP 단계", before: "VIP3", after: "VIP4" }] } }]) as never
    );

    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "올려줘");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText("시트 수정 제안")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "적용" })).toBeInTheDocument();
  });

  it("shows the reason when the stream ends in error", async () => {
    vi.mocked(global.fetch).mockResolvedValue(ndjson([{ type: "error", reason: "sheet_forbidden" }]) as never);

    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "x");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText(/시트를 읽을 권한이 없습니다/)).toBeInTheDocument());
  });

  it("renders attachment chips under stored user messages", () => {
    render(
      <ChatPane
        gameId="g1"
        conversationId="c1"
        initialMessages={[{ id: "m1", role: "user", content: "확인", proposal: null, status: null, failureReason: null, appliedBy: null, appliedAt: null, attachments: [{ name: "보상.txt", size: 2048 }] }]}
      />
    );
    expect(screen.getByText("보상.txt")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
  });

  it("lists picked files as chips and removes one on click", async () => {
    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);

    await userEvent.upload(screen.getByLabelText("파일 첨부"), [new File(["a"], "보상.txt", { type: "text/plain" }), new File(["b"], "코드.csv", { type: "text/csv" })]);
    expect(screen.getByText("보상.txt")).toBeInTheDocument();
    expect(screen.getByText("코드.csv")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "보상.txt 제거" }));
    expect(screen.queryByText("보상.txt")).not.toBeInTheDocument();
    expect(screen.getByText("코드.csv")).toBeInTheDocument();
  });

  it("refuses unsupported or oversized files before they become chips", async () => {
    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);

    // 파일 선택창의 "모든 파일"로 accept를 우회한 경우.
    await userEvent.upload(screen.getByLabelText("파일 첨부"), new File(["x"], "a.pdf", { type: "application/pdf" }), { applyAccept: false });
    expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/지원하지 않는 형식/);

    const big = new File(["x"], "big.txt", { type: "text/plain" });
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 });
    await userEvent.upload(screen.getByLabelText("파일 첨부"), big);
    expect(screen.queryByText("big.txt")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/파일당 4MB/);
  });

  it("refuses a file that would push the message total over 4MB", async () => {
    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);
    const first = new File(["x"], "a.txt", { type: "text/plain" });
    Object.defineProperty(first, "size", { value: 3 * 1024 * 1024 });
    const second = new File(["x"], "b.txt", { type: "text/plain" });
    Object.defineProperty(second, "size", { value: 2 * 1024 * 1024 });

    await userEvent.upload(screen.getByLabelText("파일 첨부"), first);
    await userEvent.upload(screen.getByLabelText("파일 첨부"), second);

    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(screen.queryByText("b.txt")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/합계 4MB/);
  });

  it("sends files as multipart and shows them under the user bubble", async () => {
    vi.mocked(global.fetch).mockResolvedValue(ndjson([{ type: "text", text: "확인했습니다" }]) as never);

    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);
    await userEvent.upload(screen.getByLabelText("파일 첨부"), new File(["52009 VIP3"], "보상.txt", { type: "text/plain" }));
    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "이 파일 봐줘");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("/api/assistant/conversations/c1/messages");
    const body = init!.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("content")).toBe("이 파일 봐줘");
    expect((body.getAll("files") as File[]).map((file) => file.name)).toEqual(["보상.txt"]);

    await waitFor(() => expect(screen.getByText("확인했습니다")).toBeInTheDocument());
    // 보낸 뒤: 말풍선 아래 칩은 남고 입력창 위 칩은 사라진다.
    expect(screen.getByText("보상.txt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "보상.txt 제거" })).not.toBeInTheDocument();
  });

  it("can send a file with no text and titles the new conversation after it", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, conversationId: "c9" }) } as never)
      .mockResolvedValueOnce(ndjson([{ type: "text", text: "네" }]) as never);

    render(<ChatPane gameId="g1" conversationId={null} initialMessages={[]} />);
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    await userEvent.upload(screen.getByLabelText("파일 첨부"), new File(["x"], "vip.xlsx"));
    expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(vi.mocked(global.fetch).mock.calls).toHaveLength(2));
    expect(JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)).toEqual({ gameId: "g1", firstMessage: "vip.xlsx" });
  });

  it("explains an attachment rejection from the server", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, body: null, json: () => Promise.resolve({ success: false, error: "attachments_too_large" }) } as never);

    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);
    await userEvent.upload(screen.getByLabelText("파일 첨부"), new File(["x"], "a.txt"));
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/첨부 파일이 너무 많습니다/));
  });

  it("shows a JSON rejection before the stream", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, body: null, json: () => Promise.resolve({ success: false, error: "not_configured" }) } as never);

    render(<ChatPane gameId="g1" conversationId="c1" initialMessages={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "x");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText(/설정되지 않았습니다/)).toBeInTheDocument());
  });
});
