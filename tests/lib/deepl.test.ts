import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deeplEndpoint, isSameLanguage, translateText } from "@/lib/deepl";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("deeplEndpoint", () => {
  it("uses the free host for keys ending in :fx and the pro host otherwise", () => {
    expect(deeplEndpoint("abc:fx")).toBe("https://api-free.deepl.com/v2/translate");
    expect(deeplEndpoint("abc")).toBe("https://api.deepl.com/v2/translate");
  });
});

describe("isSameLanguage", () => {
  it("matches DeepL's detected language against our target code", () => {
    expect(isSameLanguage("KO", "ko")).toBe(true);
    expect(isSameLanguage("ZH", "zh")).toBe(true);
    expect(isSameLanguage("ZH-HANS", "zh")).toBe(true);
    expect(isSameLanguage("EN", "ko")).toBe(false);
    expect(isSameLanguage("KO", "zh")).toBe(false);
  });
});

describe("translateText", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEEPL_API_KEY;
  });

  it("reports not_configured when the key is missing", async () => {
    await expect(translateText("hello", "ko")).resolves.toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the free endpoint with the DeepL target code and returns the translation", async () => {
    process.env.DEEPL_API_KEY = "key:fx";
    fetchMock.mockResolvedValue(
      jsonResponse(200, { translations: [{ detected_source_language: "KO", text: "你好" }] })
    );

    const result = await translateText("안녕하세요", "zh");

    expect(result).toEqual({ ok: true, text: "你好", sourceLang: "KO" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api-free.deepl.com/v2/translate");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("DeepL-Auth-Key key:fx");
    expect(JSON.parse(init.body)).toEqual({ text: ["안녕하세요"], target_lang: "ZH-HANS" });
  });

  it("maps Korean to KO", async () => {
    process.env.DEEPL_API_KEY = "key";
    fetchMock.mockResolvedValue(jsonResponse(200, { translations: [{ detected_source_language: "ZH", text: "안녕" }] }));

    await translateText("你好", "ko");

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepl.com/v2/translate");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).target_lang).toBe("KO");
  });

  it("distinguishes auth, quota and other failures", async () => {
    process.env.DEEPL_API_KEY = "key";
    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
    await expect(translateText("x", "ko")).resolves.toEqual({ ok: false, reason: "auth_failed" });

    fetchMock.mockResolvedValueOnce(jsonResponse(456, {}));
    await expect(translateText("x", "ko")).resolves.toEqual({ ok: false, reason: "quota_exceeded" });

    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
    await expect(translateText("x", "ko")).resolves.toEqual({ ok: false, reason: "failed" });

    fetchMock.mockRejectedValueOnce(new Error("network"));
    await expect(translateText("x", "ko")).resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("treats a response without translations as a failure", async () => {
    process.env.DEEPL_API_KEY = "key";
    fetchMock.mockResolvedValue(jsonResponse(200, { translations: [] }));
    await expect(translateText("x", "ko")).resolves.toEqual({ ok: false, reason: "failed" });
  });
});
