// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReplyComposer from "@/components/inbox/ReplyComposer";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
const uploadToSignedUrl = vi.fn();
const shrinkImage = vi.fn();
vi.mock("@/lib/shrink-image", () => ({ shrinkImage: (...args: unknown[]) => shrinkImage(...args) }));
vi.mock("@/lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }),
}));

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

/** /suggest는 NDJSON 스트림, 나머지는 성공 JSON. */
function mockFetch(events: Event[], other: unknown = { success: true }) {
  global.fetch = vi.fn().mockImplementation((url: string) =>
    Promise.resolve(String(url).endsWith("/suggest") ? ndjsonResponse(events) : { ok: true, json: () => Promise.resolve(other) })
  ) as never;
}

function renderIt(props: Partial<React.ComponentProps<typeof ReplyComposer>> = {}) {
  return render(
    <ReplyComposer inquiryId="inq-1" replyEmail="user@example.com" initialDraft={null} autosaveDelayMs={60_000} {...props} />
  );
}

const FULL = "안녕하세요, 확인 후 안내드리겠습니다.";
const reply = () => screen.getByLabelText("답변 내용");

describe("ReplyComposer", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    mockFetch([{ type: "text", text: FULL }]);
  });

  describe("photos", () => {
    const png = (name: string, size = 10) => {
      const file = new File([new Uint8Array(size)], name, { type: "image/png" });
      return file;
    };

    /** 업로드 주소 발급과 발송을 흉내 낸다. */
    function mockUploadFlow(replyResult: unknown = { success: true }) {
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (String(url).endsWith("/reply/uploads")) {
          const files = JSON.parse(String(init?.body)).files as Array<{ name: string }>;
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                uploads: files.map((file, index) => ({ path: `inq-1/messages/u${index}-${file.name}`, token: `t${index}`, fileName: file.name })),
              }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(replyResult) });
      }) as never;
    }

    beforeEach(() => {
      shrinkImage.mockReset();
      uploadToSignedUrl.mockReset().mockResolvedValue({ data: {}, error: null });
    });

    it("uploads the picked photos first and sends their paths with the reply", async () => {
      mockUploadFlow();
      renderIt();
      await userEvent.upload(screen.getByTestId("reply-image-input"), [png("보상.png")]);
      expect(screen.getByRole("button", { name: "보상.png 빼기" })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "발송" }));

      expect(await screen.findByText("답변이 발송되었습니다.")).toBeInTheDocument();
      expect(uploadToSignedUrl).toHaveBeenCalledWith("inq-1/messages/u0-보상.png", "t0", expect.any(File), { contentType: "image/png" });
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/inquiries/inq-1/reply",
        expect.objectContaining({
          body: JSON.stringify({ replyContent: "", attachments: [{ path: "inq-1/messages/u0-보상.png", fileName: "보상.png" }] }),
        })
      );
      expect(screen.queryByRole("button", { name: "보상.png 빼기" })).not.toBeInTheDocument();
    });

    it("takes a pasted screenshot as a photo instead of text", async () => {
      renderIt();
      const file = png("image.png");
      await act(async () => {
        const event = new globalThis.Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { value: { files: [file] } });
        reply().dispatchEvent(event);
      });
      expect(screen.getByRole("button", { name: "image.png 빼기" })).toBeInTheDocument();
    });

    it("refuses files that are not photos or too big, and removes a photo on ×", async () => {
      renderIt();
      const input = screen.getByTestId("reply-image-input");
      await userEvent.upload(input, [new File(["x"], "log.pdf", { type: "application/pdf" })], { applyAccept: false });
      expect(screen.getByText("PNG·JPG·GIF·WEBP 사진만 붙일 수 있습니다.")).toBeInTheDocument();

      shrinkImage.mockResolvedValueOnce(null);
      await userEvent.upload(input, [png("huge.png", 5 * 1024 * 1024 + 1)]);
      expect(await screen.findByText("사진을 5MB 아래로 줄이지 못했습니다.")).toBeInTheDocument();

      await userEvent.upload(input, [png("a.png")]);
      await userEvent.click(screen.getByRole("button", { name: "a.png 빼기" }));
      expect(screen.queryByRole("button", { name: "a.png 빼기" })).not.toBeInTheDocument();
    });

    it("shrinks a photo over 5MB to JPEG before attaching it", async () => {
      const shrunk = new File([new Uint8Array(100)], "big.jpg", { type: "image/jpeg" });
      shrinkImage.mockResolvedValueOnce(shrunk);
      renderIt();
      const big = png("big.png", 5 * 1024 * 1024 + 1);
      await userEvent.upload(screen.getByTestId("reply-image-input"), [big]);
      expect(await screen.findByRole("button", { name: "big.jpg 빼기" })).toBeInTheDocument();
      expect(shrinkImage).toHaveBeenCalledWith(big, 5 * 1024 * 1024);
      expect(screen.queryByText(/5MB/)).not.toBeInTheDocument();
    });

    it("does not send when the upload fails and keeps the photo for a retry", async () => {
      mockUploadFlow();
      uploadToSignedUrl.mockResolvedValue({ data: null, error: { message: "boom" } });
      renderIt();
      await userEvent.type(reply(), "안내드립니다");
      await userEvent.upload(screen.getByTestId("reply-image-input"), [png("a.png")]);
      await userEvent.click(screen.getByRole("button", { name: "발송" }));

      expect(await screen.findByText("사진을 올리지 못했습니다. 다시 시도해주세요.")).toBeInTheDocument();
      expect(global.fetch).not.toHaveBeenCalledWith("/api/inquiries/inq-1/reply", expect.anything());
      expect(reply()).toHaveValue("안내드립니다");
      expect(screen.getByRole("button", { name: "a.png 빼기" })).toBeInTheDocument();
    });

    it("hides the photo button in memo mode", async () => {
      renderIt();
      await userEvent.click(screen.getByRole("tab", { name: "메모" }));
      expect(screen.queryByRole("button", { name: "사진" })).not.toBeInTheDocument();
    });
  });

  describe("reply mode", () => {
    it("starts in reply mode with the recipient, a send button, and nothing else to pick from", () => {
      renderIt();
      expect(screen.getByRole("tab", { name: "답변" })).toHaveAttribute("aria-selected", "true");
      expect(reply()).toHaveValue("");
      expect(screen.getByText("받는 사람 user@example.com")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "발송" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "AI 답변 추천" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "초안 저장" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("템플릿 선택")).not.toBeInTheDocument();
    });

    it("prefills the box with the saved draft", () => {
      renderIt({ initialDraft: "작성하던 답변" });
      expect(reply()).toHaveValue("작성하던 답변");
    });

    it("sends the reply, empties the box, and refreshes", async () => {
      renderIt();
      await userEvent.type(reply(), "확인 후 조치하겠습니다");
      await userEvent.click(screen.getByRole("button", { name: "발송" }));

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/inquiries/inq-1/reply",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ replyContent: "확인 후 조치하겠습니다", attachments: [] }) })
      );
      expect(await screen.findByText("답변이 발송되었습니다.")).toBeInTheDocument();
      expect(reply()).toHaveValue("");
      expect(refreshMock).toHaveBeenCalled();
    });

    it("does not send an empty reply", async () => {
      renderIt();
      await userEvent.click(screen.getByRole("button", { name: "발송" }));
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("keeps the text and explains when sending fails", async () => {
      mockFetch([], { success: false, error: "send_failed" });
      renderIt();
      await userEvent.type(reply(), "확인 후 조치하겠습니다");
      await userEvent.click(screen.getByRole("button", { name: "발송" }));

      expect(await screen.findByText("발송 실패, 다시 시도해주세요.")).toBeInTheDocument();
      expect(reply()).toHaveValue("확인 후 조치하겠습니다");
      expect(refreshMock).not.toHaveBeenCalled();
    });

    it("keeps the text and re-enables the button when the request throws", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as never;
      renderIt();
      await userEvent.type(reply(), "확인 후 조치하겠습니다");
      const button = screen.getByRole("button", { name: "발송" });
      await userEvent.click(button);

      expect(await screen.findByText("발송 실패, 다시 시도해주세요.")).toBeInTheDocument();
      expect(reply()).toHaveValue("확인 후 조치하겠습니다");
      expect(button).not.toBeDisabled();
    });

    it("warns when the mail went out but the record could not be saved", async () => {
      mockFetch([], { success: true, warning: "message_save_failed" });
      renderIt();
      await userEvent.type(reply(), "보냅니다");
      await userEvent.click(screen.getByRole("button", { name: "발송" }));
      expect(await screen.findByText(/대화 기록 저장에는 실패했습니다/)).toBeInTheDocument();
    });

    it("sends with Cmd+Enter and inserts a newline on a plain Enter", async () => {
      renderIt();
      await userEvent.type(reply(), "첫 줄{Enter}둘째 줄");
      expect(global.fetch).not.toHaveBeenCalled();
      expect(reply()).toHaveValue("첫 줄\n둘째 줄");

      await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/inquiries/inq-1/reply",
          expect.objectContaining({ body: JSON.stringify({ replyContent: "첫 줄\n둘째 줄", attachments: [] }) })
        )
      );
    });
  });

  describe("note mode", () => {
    it("turns the same box into a staff-only note with its own send button", async () => {
      renderIt();
      await userEvent.click(screen.getByRole("tab", { name: "메모" }));

      expect(screen.getByRole("tab", { name: "메모" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByLabelText("내부 메모")).toHaveAttribute("placeholder", expect.stringContaining("사용자에게 보이지 않습니다"));
      expect(screen.getByRole("button", { name: "메모 남기기" })).toBeInTheDocument();
      expect(screen.queryByText(/받는 사람/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "AI 답변 추천" })).not.toBeInTheDocument();
      expect(screen.getByTestId("composer")).toHaveAttribute("data-mode", "note");
    });

    it("posts the trimmed note, clears it, and refreshes", async () => {
      renderIt();
      await userEvent.click(screen.getByRole("tab", { name: "메모" }));
      await userEvent.type(screen.getByLabelText("내부 메모"), "  확인함 ");
      await userEvent.click(screen.getByRole("button", { name: "메모 남기기" }));

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/inquiries/inq-1/notes",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "확인함" }) })
      );
      expect(refreshMock).toHaveBeenCalled();
      expect(screen.getByLabelText("내부 메모")).toHaveValue("");
    });

    it("does nothing for an empty note", async () => {
      renderIt();
      await userEvent.click(screen.getByRole("tab", { name: "메모" }));
      await userEvent.click(screen.getByRole("button", { name: "메모 남기기" }));
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("explains when the note could not be saved", async () => {
      mockFetch([], { success: false });
      renderIt();
      await userEvent.click(screen.getByRole("tab", { name: "메모" }));
      await userEvent.type(screen.getByLabelText("내부 메모"), "x");
      await userEvent.click(screen.getByRole("button", { name: "메모 남기기" }));
      expect(await screen.findByText("메모 저장에 실패했습니다.")).toBeInTheDocument();
      expect(refreshMock).not.toHaveBeenCalled();
    });

    it("saves the note with Cmd+Enter", async () => {
      renderIt();
      await userEvent.click(screen.getByRole("tab", { name: "메모" }));
      await userEvent.type(screen.getByLabelText("내부 메모"), "단축키");
      await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
      await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/inquiries/inq-1/notes", expect.anything()));
    });

    it("keeps the reply text and the note text apart when switching", async () => {
      renderIt({ initialDraft: "답변 초안" });
      await userEvent.click(screen.getByRole("tab", { name: "메모" }));
      await userEvent.type(screen.getByLabelText("내부 메모"), "메모 글");
      await userEvent.click(screen.getByRole("tab", { name: "답변" }));
      expect(reply()).toHaveValue("답변 초안");
      await userEvent.click(screen.getByRole("tab", { name: "메모" }));
      expect(screen.getByLabelText("내부 메모")).toHaveValue("메모 글");
    });
  });

  describe("quiet autosave", () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    it("saves the draft after typing pauses without saying so", async () => {
      renderIt({ autosaveDelayMs: 50 });
      await userEvent.type(reply(), "자동 저장");
      expect(global.fetch).not.toHaveBeenCalled();

      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/inquiries/inq-1/draft",
          expect.objectContaining({ method: "PUT", body: JSON.stringify({ draftReply: "자동 저장" }) })
        )
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/저장됨/)).not.toBeInTheDocument();
    });

    it("does not save an untouched prefilled draft", async () => {
      renderIt({ initialDraft: "이미 저장된 초안", autosaveDelayMs: 20 });
      await act(() => sleep(80));
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("does not resave the same text twice", async () => {
      renderIt({ autosaveDelayMs: 30 });
      await userEvent.type(reply(), "한 번만");
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
      await act(() => sleep(120));
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("AI suggestion", () => {
    it("writes the suggestion straight into the box, sending the current draft along", async () => {
      renderIt();
      await userEvent.type(reply(), "누락분 지급했습니다");
      await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

      const call = vi.mocked(global.fetch).mock.calls.find(([url]) => String(url).endsWith("/suggest"));
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ draft: "누락분 지급했습니다" });
      await waitFor(() => expect(reply()).toHaveValue(FULL));
      expect(screen.getByText("초안을 다듬었습니다. 검토 뒤 발송하세요.")).toBeInTheDocument();
    });

    it("says the whole reply was written by AI when the box was empty", async () => {
      renderIt();
      await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
      await waitFor(() => expect(reply()).toHaveValue(FULL));
      expect(screen.getByText("AI가 쓴 제안입니다. 검토 뒤 발송하세요.")).toBeInTheDocument();
    });

    it("locks the box and offers to stop while the text is streaming", async () => {
      const encoder = new TextEncoder();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({ ok: true, status: 200, body: new ReadableStream<Uint8Array>({ start(c) { controller = c; } }) })
      ) as never;
      renderIt();
      await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
      controller.enqueue(encoder.encode(JSON.stringify({ type: "text", text: "안녕하세요, " }) + "\n"));

      await waitFor(() => expect(reply()).toHaveValue("안녕하세요, "));
      expect(reply()).toHaveAttribute("readonly");
      expect(screen.getByTestId("composer")).toHaveAttribute("data-writing", "true");
      expect(screen.getByRole("button", { name: "발송" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "AI 답변 추천" })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "중단" }));

      expect(reply()).toHaveValue("안녕하세요,");
      expect(reply()).not.toHaveAttribute("readonly");
      expect(screen.getByText("생성이 중단됐습니다. 여기까지 온 내용은 그대로 쓸 수 있습니다.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "발송" })).not.toBeDisabled();
    });

    it("restores what was there before with 되돌리기, which disappears once the admin edits", async () => {
      renderIt({ initialDraft: "누락분 지급했습니다" });
      await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
      await waitFor(() => expect(reply()).toHaveValue(FULL));

      await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
      expect(reply()).toHaveValue("누락분 지급했습니다");
      expect(screen.queryByRole("button", { name: "되돌리기" })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
      await waitFor(() => expect(reply()).toHaveValue(FULL));
      await userEvent.type(reply(), " 감사합니다.");
      expect(screen.queryByRole("button", { name: "되돌리기" })).not.toBeInTheDocument();
    });

    it("lists the evidence under the box and drops it when the reply is sent", async () => {
      mockFetch([{ type: "text", text: `${FULL}\n=== 근거 ===\n- 운영정책 문서 환불 정책 안내\n- 과거 답변 R-20260902-0001` }]);
      renderIt();
      await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
      await waitFor(() => expect(reply()).toHaveValue(FULL));

      const list = screen.getByRole("list", { name: "참고한 자료" });
      expect(list).toHaveTextContent("운영정책 문서 환불 정책 안내");
      expect(list).toHaveTextContent("과거 답변 R-20260902-0001");
      expect(list.querySelector('[data-kind="doc"]')).not.toBeNull();
      expect(list.querySelector('[data-kind="reply"]')).not.toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "발송" }));
      await screen.findByText("답변이 발송되었습니다.");
      expect(screen.queryByRole("list", { name: "참고한 자료" })).not.toBeInTheDocument();
    });

    it("shows the warnings next to the caption", async () => {
      mockFetch([{ type: "warning", reason: "similar_unavailable" }, { type: "text", text: FULL }]);
      renderIt();
      await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));
      expect(await screen.findByText("유사 문의 검색이 안 돼 같은 유형의 최근 답변만 참고했습니다.")).toBeInTheDocument();
    });

    it("puts the previous text back and explains when the suggestion fails outright", async () => {
      mockFetch([{ type: "error", reason: "not_configured" }]);
      renderIt({ initialDraft: "내 초안" });
      await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

      expect(await screen.findByText("OPENAI_API_KEY가 설정되지 않았습니다.")).toBeInTheDocument();
      expect(reply()).toHaveValue("내 초안");
      expect(screen.getByRole("button", { name: "AI 답변 추천" })).not.toBeDisabled();
    });

    it("keeps partial text when the stream fails midway", async () => {
      mockFetch([{ type: "text", text: "앞부분입니다." }, { type: "error", reason: "failed" }]);
      renderIt();
      await userEvent.click(screen.getByRole("button", { name: "AI 답변 추천" }));

      expect(await screen.findByText("추천 생성에 실패했습니다.")).toBeInTheDocument();
      expect(reply()).toHaveValue("앞부분입니다.");
      expect(screen.getByRole("button", { name: "되돌리기" })).toBeInTheDocument();
    });
  });
});
