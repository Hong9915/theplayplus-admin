import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/translate/route";
import * as supabaseModule from "@/lib/supabase";
import * as inquiriesModule from "@/lib/inquiries";
import * as messagesModule from "@/lib/messages";
import * as translationsModule from "@/lib/translations";
import * as deeplModule from "@/lib/deepl";
import * as sessionModule from "@/lib/require-admin-session";

vi.mock("@/lib/supabase", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/inquiries", () => ({ getInquiryById: vi.fn() }));
vi.mock("@/lib/messages", () => ({ getMessage: vi.fn() }));
vi.mock("@/lib/deepl", async (importOriginal) => ({
  ...(await importOriginal<typeof deeplModule>()),
  translateText: vi.fn(),
}));
vi.mock("@/lib/translations", async (importOriginal) => ({
  ...(await importOriginal<typeof translationsModule>()),
  saveTranslation: vi.fn(),
}));
vi.mock("@/lib/require-admin-session", () => ({ requireAdminSession: vi.fn() }));

function postRequest(body: unknown) {
  return new Request("http://localhost/api/inquiries/inq-1/translate", { method: "POST", body: JSON.stringify(body) });
}

const inquiry = { id: "inq-1", content: "你好，我的账号丢了" };
const message = { id: "m-1", direction: "inbound", body: "谢谢" };

describe("POST /api/inquiries/[id]/translate", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset().mockReturnValue({} as never);
    vi.mocked(sessionModule.requireAdminSession).mockReset().mockResolvedValue(true);
    vi.mocked(inquiriesModule.getInquiryById).mockReset().mockResolvedValue(inquiry as never);
    vi.mocked(messagesModule.getMessage).mockReset().mockResolvedValue(message as never);
    vi.mocked(deeplModule.translateText).mockReset().mockResolvedValue({ ok: true, text: "안녕하세요, 계정을 잃어버렸어요", sourceLang: "ZH" });
    vi.mocked(translationsModule.saveTranslation).mockReset().mockResolvedValue(true);
  });

  it("returns 401 without an admin session", async () => {
    vi.mocked(sessionModule.requireAdminSession).mockResolvedValue(false);
    const response = await POST(postRequest({ target: "inquiry", lang: "ko" }), { params: { id: "inq-1" } });
    expect(response.status).toBe(401);
    expect(deeplModule.translateText).not.toHaveBeenCalled();
  });

  it("rejects an unknown language or target", async () => {
    let response = await POST(postRequest({ target: "inquiry", lang: "en" }), { params: { id: "inq-1" } });
    expect(response.status).toBe(400);
    response = await POST(postRequest({ target: "message", lang: "ko" }), { params: { id: "inq-1" } });
    expect(response.status).toBe(400);
    expect(deeplModule.translateText).not.toHaveBeenCalled();
  });

  it("translates the inquiry body from the database and saves it", async () => {
    const response = await POST(postRequest({ target: "inquiry", lang: "ko" }), { params: { id: "inq-1" } });

    expect(deeplModule.translateText).toHaveBeenCalledWith("你好，我的账号丢了", "ko");
    expect(translationsModule.saveTranslation).toHaveBeenCalledWith(expect.anything(), { kind: "inquiry", id: "inq-1" }, "ko", "안녕하세요, 계정을 잃어버렸어요");
    await expect(response.json()).resolves.toEqual({ success: true, text: "안녕하세요, 계정을 잃어버렸어요", saved: true });
  });

  it("translates a message that belongs to the inquiry", async () => {
    vi.mocked(deeplModule.translateText).mockResolvedValue({ ok: true, text: "감사합니다", sourceLang: "ZH" });

    const response = await POST(postRequest({ target: "message", messageId: "m-1", lang: "ko" }), { params: { id: "inq-1" } });

    expect(messagesModule.getMessage).toHaveBeenCalledWith(expect.anything(), "inq-1", "m-1");
    expect(deeplModule.translateText).toHaveBeenCalledWith("谢谢", "ko");
    expect(translationsModule.saveTranslation).toHaveBeenCalledWith(expect.anything(), { kind: "message", id: "m-1" }, "ko", "감사합니다");
    await expect(response.json()).resolves.toEqual({ success: true, text: "감사합니다", saved: true });
  });

  it("returns 404 when the inquiry or message is missing", async () => {
    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(null);
    let response = await POST(postRequest({ target: "inquiry", lang: "ko" }), { params: { id: "inq-1" } });
    expect(response.status).toBe(404);

    vi.mocked(inquiriesModule.getInquiryById).mockResolvedValue(inquiry as never);
    vi.mocked(messagesModule.getMessage).mockResolvedValue(null);
    response = await POST(postRequest({ target: "message", messageId: "m-9", lang: "ko" }), { params: { id: "inq-1" } });
    expect(response.status).toBe(404);
    expect(deeplModule.translateText).not.toHaveBeenCalled();
  });

  it("does not save when the text is already in the target language", async () => {
    vi.mocked(deeplModule.translateText).mockResolvedValue({ ok: true, text: "同じ", sourceLang: "KO" });

    const response = await POST(postRequest({ target: "inquiry", lang: "ko" }), { params: { id: "inq-1" } });

    expect(translationsModule.saveTranslation).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ success: false, error: "same_language" });
  });

  it("passes DeepL failures through with a matching status", async () => {
    vi.mocked(deeplModule.translateText).mockResolvedValueOnce({ ok: false, reason: "not_configured" });
    let response = await POST(postRequest({ target: "inquiry", lang: "ko" }), { params: { id: "inq-1" } });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ success: false, error: "not_configured" });

    vi.mocked(deeplModule.translateText).mockResolvedValueOnce({ ok: false, reason: "quota_exceeded" });
    response = await POST(postRequest({ target: "inquiry", lang: "ko" }), { params: { id: "inq-1" } });
    expect(response.status).toBe(429);

    vi.mocked(deeplModule.translateText).mockResolvedValueOnce({ ok: false, reason: "failed" });
    response = await POST(postRequest({ target: "inquiry", lang: "ko" }), { params: { id: "inq-1" } });
    expect(response.status).toBe(502);
    expect(translationsModule.saveTranslation).not.toHaveBeenCalled();
  });

  it("still returns the text when saving fails", async () => {
    vi.mocked(translationsModule.saveTranslation).mockResolvedValue(false);
    const response = await POST(postRequest({ target: "inquiry", lang: "ko" }), { params: { id: "inq-1" } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, text: "안녕하세요, 계정을 잃어버렸어요", saved: false });
  });
});
