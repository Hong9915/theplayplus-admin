import type { SupabaseClient } from "@supabase/supabase-js";

/** 우클릭 메뉴가 고를 수 있는 목표 언어. 관리자 UI가 한국어라 ko, 중국 사용자가 많아 zh. */
export type TranslationLang = "ko" | "zh";
export const TRANSLATION_LANGS: TranslationLang[] = ["ko", "zh"];

/** 언어 코드 → 언어별 번역문. DB의 translations jsonb와 같은 모양. */
export type Translations = Partial<Record<TranslationLang, string>>;

export const TRANSLATION_LABELS: Record<TranslationLang, string> = {
  ko: "한국어",
  zh: "중국어(간체)",
};

/** 번역문 위에 붙는 짧은 표시. 중국어는 사용자에게 익숙한 표기를 쓴다. */
export const TRANSLATION_BADGES: Record<TranslationLang, string> = {
  ko: "한국어",
  zh: "中文(简体)",
};

export function isTranslationLang(value: unknown): value is TranslationLang {
  return value === "ko" || value === "zh";
}

/** jsonb 값을 그대로 믿지 않는다 — 아는 언어 키의 문자열만 남긴다. */
export function parseTranslations(raw: unknown): Translations {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const result: Translations = {};
  for (const lang of TRANSLATION_LANGS) {
    const value = (raw as Record<string, unknown>)[lang];
    if (typeof value === "string") {
      result[lang] = value;
    }
  }
  return result;
}

export type TranslationTarget = { kind: "inquiry"; id: string } | { kind: "message"; id: string };

const TABLE: Record<TranslationTarget["kind"], string> = {
  inquiry: "inquiries",
  message: "inquiry_messages",
};

/**
 * 한 언어의 번역문을 기존 값에 합쳐 저장한다. 읽고 나서 쓰므로 같은 말풍선을
 * 두 관리자가 동시에 다른 언어로 번역하면 하나가 사라질 수 있지만, 다시 누르면
 * 되는 캐시라 감수한다. 실패는 false — 번역문 자체는 이미 화면에 보여줄 수 있다.
 */
export async function saveTranslation(
  supabase: SupabaseClient,
  target: TranslationTarget,
  lang: TranslationLang,
  text: string
): Promise<boolean> {
  const table = TABLE[target.kind];
  const { data, error: readError } = await supabase.from(table).select("translations").eq("id", target.id).single();
  if (readError) {
    return false;
  }
  const merged: Translations = { ...parseTranslations(data?.translations), [lang]: text };
  const { error } = await supabase.from(table).update({ translations: merged }).eq("id", target.id);
  return !error;
}
