import type { TranslationLang } from "@/lib/translations";

/** DeepL target_lang 코드. 중국어는 간체(ZH-HANS)로 고정한다. */
const DEEPL_TARGET: Record<TranslationLang, string> = {
  ko: "KO",
  zh: "ZH-HANS",
};

export type TranslateErrorReason = "not_configured" | "auth_failed" | "quota_exceeded" | "failed";

export type TranslateResult =
  | { ok: true; text: string; sourceLang: string }
  | { ok: false; reason: TranslateErrorReason };

/** 무료 플랜 키는 ":fx"로 끝나고 다른 호스트를 쓴다. 키만 보고 고른다. */
export function deeplEndpoint(apiKey: string): string {
  const host = apiKey.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
  return `https://${host}/v2/translate`;
}

/**
 * DeepL이 감지한 원문 언어(KO, ZH, ZH-HANS, EN …)가 우리 목표 언어와 같은지.
 * 같으면 번역할 이유가 없으니 화면이 "이미 그 언어입니다"로 안내한다.
 */
export function isSameLanguage(detected: string, lang: TranslationLang): boolean {
  return detected.toUpperCase().startsWith(lang.toUpperCase());
}

/** DeepL v2 /translate 한 번 호출. 키가 없으면 부르지 않는다. */
export async function translateText(text: string, lang: TranslationLang): Promise<TranslateResult> {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "not_configured" };
  }

  let response: Response;
  try {
    response = await fetch(deeplEndpoint(apiKey), {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: [text], target_lang: DEEPL_TARGET[lang] }),
    });
  } catch {
    return { ok: false, reason: "failed" };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "auth_failed" };
  }
  // 456은 DeepL이 정한 "이번 달 글자 한도 초과" 코드다.
  if (response.status === 456) {
    return { ok: false, reason: "quota_exceeded" };
  }
  if (!response.ok) {
    return { ok: false, reason: "failed" };
  }

  let json: { translations?: Array<{ detected_source_language?: string; text?: string }> };
  try {
    json = await response.json();
  } catch {
    return { ok: false, reason: "failed" };
  }
  const first = json.translations?.[0];
  if (!first || typeof first.text !== "string") {
    return { ok: false, reason: "failed" };
  }
  return { ok: true, text: first.text, sourceLang: first.detected_source_language ?? "" };
}
