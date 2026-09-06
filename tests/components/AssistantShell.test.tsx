// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AssistantShell from "@/components/assistant/AssistantShell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));

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

const game = { id: "g1", name: "여신 키우기", sheetId: "sheet-1" };

describe("AssistantShell", () => {
  beforeEach(() => {
    global.fetch = vi.fn() as never;
  });

  it("keeps ChatPane mounted (and its streamed text) across the null → created-conversation re-render", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, conversationId: "c9" }) } as never)
      .mockResolvedValueOnce(ndjson([{ type: "text", text: "VIP3입니다" }]) as never);

    const { rerender } = render(
      <AssistantShell game={game} conversations={[]} selectedId={null} messages={[]} serviceAccountEmail={null} />
    );

    await userEvent.type(screen.getByRole("textbox", { name: "메시지" }), "52009 VIP?");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(screen.getByText("VIP3입니다")).toBeInTheDocument());

    // 서버가 ?c=c9로 다시 렌더한 것을 흉내낸다 — 페인이 리마운트됐다면 스트리밍된
    // 텍스트(클라이언트 state)가 사라지고 initialMessages([])만 남는다.
    rerender(<AssistantShell game={game} conversations={[]} selectedId="c9" messages={[]} serviceAccountEmail={null} />);

    expect(screen.getByText("VIP3입니다")).toBeInTheDocument();
    expect(screen.getByText("52009 VIP?")).toBeInTheDocument();
  });
});
