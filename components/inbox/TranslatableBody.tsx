"use client";

import { useEffect, useRef, useState } from "react";
import {
  TRANSLATION_BADGES,
  TRANSLATION_LABELS,
  TRANSLATION_LANGS,
  type TranslationLang,
  type Translations,
} from "@/lib/translations";

export type TranslateTarget = { kind: "inquiry" } | { kind: "message"; messageId: string };

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "DEEPL_API_KEY가 설정되지 않았습니다. 환경변수를 넣고 다시 배포하세요.",
  auth_failed: "DeepL 인증에 실패했습니다. DEEPL_API_KEY를 확인하세요.",
  quota_exceeded: "DeepL 이번 달 번역 한도를 넘었습니다.",
};

type LangState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "notice"; message: string };

/**
 * 말풍선 본문. 우클릭하면 언어별 "번역" 메뉴가 뜨고, 번역문은 WeChat처럼 원문
 * 아래에 이어서 붙는다. 이미 저장된 번역은 처음부터 보이고 메뉴는 숨기기/다시
 * 번역으로 바뀐다. 번역 요청은 서버가 DB의 원문으로 하므로 여기서는 본문을 보내지 않는다.
 */
export default function TranslatableBody({
  inquiryId,
  target,
  body,
  translations: initial,
}: {
  inquiryId: string;
  target: TranslateTarget;
  body: string;
  translations: Translations;
}) {
  const [translations, setTranslations] = useState<Translations>(initial);
  const [hidden, setHidden] = useState<Set<TranslationLang>>(new Set());
  const [states, setStates] = useState<Partial<Record<TranslationLang, LangState>>>({});
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function close(event: MouseEvent) {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return;
      setMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function setState(lang: TranslationLang, state: LangState | undefined) {
    setStates((prev) => ({ ...prev, [lang]: state }));
  }

  async function translate(lang: TranslationLang) {
    setMenu(null);
    setState(lang, { status: "loading" });
    setHidden((prev) => {
      const next = new Set(prev);
      next.delete(lang);
      return next;
    });

    let json: { success: boolean; text?: string; error?: string };
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target.kind === "inquiry" ? { target: "inquiry", lang } : { target: "message", messageId: target.messageId, lang }),
      });
      json = await response.json();
    } catch {
      setState(lang, { status: "error", message: "번역 요청에 실패했습니다." });
      return;
    }

    if (json.success && typeof json.text === "string") {
      setTranslations((prev) => ({ ...prev, [lang]: json.text }));
      setState(lang, undefined);
      return;
    }
    if (json.error === "same_language") {
      setState(lang, { status: "notice", message: `이미 ${TRANSLATION_LABELS[lang]}입니다.` });
      return;
    }
    setState(lang, { status: "error", message: ERROR_MESSAGES[json.error ?? ""] ?? "번역에 실패했습니다." });
  }

  function toggleHidden(lang: TranslationLang) {
    setMenu(null);
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(lang)) next.delete(lang);
      else next.add(lang);
      return next;
    });
  }

  function openMenu(event: React.MouseEvent) {
    event.preventDefault();
    const rect = rootRef.current?.getBoundingClientRect();
    setMenu({ x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) });
  }

  return (
    <div ref={rootRef} className="relative" onContextMenu={openMenu}>
      <p className="whitespace-pre-wrap break-words">{body}</p>

      {TRANSLATION_LANGS.map((lang) => {
        const state = states[lang];
        const text = translations[lang];
        if (state?.status === "loading") {
          return (
            <div key={lang} className="mt-2.5 pt-2.5 border-t border-dashed border-line text-xs text-muted">
              번역 중…
            </div>
          );
        }
        if (state?.status === "error") {
          return (
            <div key={lang} className="mt-2.5 pt-2.5 border-t border-dashed border-line text-xs text-red-600 flex flex-wrap items-center gap-2">
              <span>{state.message}</span>
              <button type="button" onClick={() => translate(lang)} className="underline underline-offset-2 hover:text-ink">
                다시 시도
              </button>
            </div>
          );
        }
        if (state?.status === "notice") {
          return (
            <div key={lang} className="mt-2.5 pt-2.5 border-t border-dashed border-line text-xs text-muted">
              {state.message}
            </div>
          );
        }
        if (!text || hidden.has(lang)) return null;
        return (
          <div key={lang} className="mt-2.5 pt-2.5 border-t border-dashed border-line" data-testid={`translation-${lang}`}>
            <div className="text-[11px] text-muted mb-1">{TRANSLATION_BADGES[lang]} · DeepL</div>
            <p className="whitespace-pre-wrap break-words">{text}</p>
          </div>
        );
      })}

      {menu && (
        <ul
          role="menu"
          className="absolute z-20 min-w-[160px] bg-panel border border-line rounded-lg shadow-lg py-1 text-xs"
          style={{ left: menu.x, top: menu.y }}
        >
          {TRANSLATION_LANGS.flatMap((lang) => {
            const label = TRANSLATION_LABELS[lang];
            if (!translations[lang]) {
              return [
                <li key={lang}>
                  <button type="button" role="menuitem" onClick={() => translate(lang)} className="w-full text-left px-3 py-1.5 hover:bg-ground">
                    {label}로 번역
                  </button>
                </li>,
              ];
            }
            return [
              <li key={`${lang}-toggle`}>
                <button type="button" role="menuitem" onClick={() => toggleHidden(lang)} className="w-full text-left px-3 py-1.5 hover:bg-ground">
                  {label} 번역 {hidden.has(lang) ? "보이기" : "숨기기"}
                </button>
              </li>,
              <li key={`${lang}-again`}>
                <button type="button" role="menuitem" onClick={() => translate(lang)} className="w-full text-left px-3 py-1.5 hover:bg-ground">
                  {label} 다시 번역
                </button>
              </li>,
            ];
          })}
        </ul>
      )}
    </div>
  );
}
