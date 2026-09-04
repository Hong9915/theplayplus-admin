// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TranslatableBody from "@/components/inbox/TranslatableBody";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function renderBody(translations = {}) {
  return render(
    <TranslatableBody inquiryId="inq-1" target={{ kind: "message", messageId: "m-1" }} body="谢谢你" translations={translations} />
  );
}

describe("TranslatableBody", () => {
  it("renders the original text and no menu until right-clicked", () => {
    renderBody();
    expect(screen.getByText("谢谢你")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens a menu with both languages on right-click and closes on Escape", () => {
    renderBody();
    fireEvent.contextMenu(screen.getByText("谢谢你"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "한국어로 번역" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "중국어(간체)로 번역" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("calls the translate API and appends the translation under the body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, text: "고마워요", saved: true }));
    renderBody();

    fireEvent.contextMenu(screen.getByText("谢谢你"));
    fireEvent.click(screen.getByRole("menuitem", { name: "한국어로 번역" }));

    expect(screen.getByText("번역 중…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("고마워요")).toBeInTheDocument());
    expect(screen.getByText("한국어 · DeepL")).toBeInTheDocument();
    expect(screen.getByText("谢谢你")).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/inquiries/inq-1/translate");
    expect(JSON.parse(init.body)).toEqual({ target: "message", messageId: "m-1", lang: "ko" });
  });

  it("shows saved translations immediately and offers hide and retranslate for them", () => {
    renderBody({ ko: "고마워요" });
    expect(screen.getByText("고마워요")).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByText("谢谢你"));
    expect(screen.getByRole("menuitem", { name: "한국어 번역 숨기기" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "한국어 다시 번역" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "중국어(간체)로 번역" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "한국어 번역 숨기기" }));
    expect(screen.queryByText("고마워요")).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText("谢谢你"));
    expect(screen.getByRole("menuitem", { name: "한국어 번역 보이기" })).toBeInTheDocument();
  });

  it("explains a missing key and lets the admin retry", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { success: false, error: "not_configured" }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, text: "고마워요", saved: true }));
    renderBody();

    fireEvent.contextMenu(screen.getByText("谢谢你"));
    fireEvent.click(screen.getByRole("menuitem", { name: "한국어로 번역" }));
    await waitFor(() => expect(screen.getByText(/DEEPL_API_KEY/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getByText("고마워요")).toBeInTheDocument());
  });

  it("tells the admin when the text is already in that language", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: false, error: "same_language" }));
    renderBody();

    fireEvent.contextMenu(screen.getByText("谢谢你"));
    fireEvent.click(screen.getByRole("menuitem", { name: "중국어(간체)로 번역" }));
    await waitFor(() => expect(screen.getByText("이미 중국어(간체)입니다.")).toBeInTheDocument());
  });
});
