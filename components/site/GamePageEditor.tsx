"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import StatusMessage from "@/components/ui/StatusMessage";
import {
  MAX_IMAGE_BYTES,
  MAX_SCREENSHOTS,
  RELEASE_STATUSES,
  RELEASE_STATUS_LABELS,
  getGameSiteImageUrl,
  type GamePage,
  type GamePageInput,
  type ImageKind,
} from "@/lib/game-pages";

const INPUT =
  "w-full bg-panel border border-line rounded px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent transition-colors";
const INPUT_INVALID = "border-red-500";

const FIELD_ERRORS: Record<string, string> = {
  slug: "영문 소문자, 숫자, 하이픈(-)만 쓸 수 있습니다. 공개하려면 꼭 입력해야 합니다.",
  titleKo: "공개하려면 한국어 제목을 입력해야 합니다.",
  youtubeId: "유튜브 영상 ID만 입력하세요. 예: Ky1PVk-TXu8",
};
const URL_ERROR = "https:// 로 시작하는 주소를 입력하세요.";

type Draft = GamePageInput;

function toDraft(page: GamePage): Draft {
  const { gameId: _gameId, kvPath: _kv, cardPath: _card, screenshotPaths: _shots, updatedAt: _updated, ...rest } = page;
  return rest;
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-red-600">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="bg-panel border border-line rounded-lg p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold">{title}</h2>
        {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default function GamePageEditor({
  page,
  loungeId,
  siteUrl,
}: {
  page: GamePage;
  /** 문의함에서 연결한 네이버 라운지 ID. 웹사이트 공지사항과 라운지 버튼이 여기서 나온다. */
  loungeId: string | null;
  siteUrl: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(page));
  const [invalid, setInvalid] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // 서버가 저장 후 새 값을 내려주면(이미지 업로드 뒤 refresh 등) 글 입력은 건드리지 않는다.
  const savedRef = useRef(toDraft(page));
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedRef.current);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setInvalid((current) => current.filter((field) => field !== key));
  }

  function text(key: keyof Draft) {
    return {
      value: draft[key] as string,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, event.target.value as never),
      className: `${INPUT} ${invalid.includes(key) ? INPUT_INVALID : ""}`,
      "aria-invalid": invalid.includes(key) || undefined,
    };
  }

  function errorFor(key: keyof Draft): string | undefined {
    if (!invalid.includes(key)) return undefined;
    return FIELD_ERRORS[key] ?? URL_ERROR;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    let json: { success: boolean; error?: string; fields?: string[]; page?: GamePage };
    try {
      const response = await fetch(`/api/games/${page.gameId}/page`, {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      json = await response.json();
    } catch {
      setSaving(false);
      setMessage({ tone: "error", text: "저장하지 못했습니다. 다시 시도해주세요." });
      return;
    }
    setSaving(false);

    if (!json.success || !json.page) {
      if (json.error === "invalid_input" && json.fields) {
        setInvalid(json.fields);
        setMessage({ tone: "error", text: "표시된 칸을 고친 뒤 다시 저장하세요." });
      } else if (json.error === "slug_taken") {
        setInvalid(["slug"]);
        setMessage({ tone: "error", text: "다른 게임이 이미 쓰는 주소입니다. 주소를 바꿔주세요." });
      } else {
        setMessage({ tone: "error", text: "저장하지 못했습니다. 다시 시도해주세요." });
      }
      return;
    }

    savedRef.current = toDraft(json.page);
    setDraft(savedRef.current);
    setMessage({
      tone: "success",
      text: json.page.published ? "저장했습니다. 웹사이트에 바로 반영됩니다." : "저장했습니다. 공개는 꺼져 있습니다.",
    });
    router.refresh();
  }

  const liveUrl = siteUrl && page.published && page.slug ? `${siteUrl.replace(/\/$/, "")}/games/${page.slug}` : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 max-w-3xl">
      <Section title="공개 설정" description="공개를 켜면 웹사이트 게임 목록과 상세 페이지에 나옵니다.">
        <label className="flex items-center justify-between gap-4 rounded border border-line px-4 py-3 cursor-pointer">
          <span className="flex flex-col">
            <span className="font-medium text-sm">웹사이트에 공개</span>
            <span className="text-xs text-muted">
              {draft.published ? "저장하면 웹사이트에 보입니다." : "꺼져 있으면 웹사이트에서 이 게임이 숨겨집니다."}
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={draft.published}
            onChange={(event) => set("published", event.target.checked)}
            className="w-10 h-5 accent-accent cursor-pointer"
          />
        </label>
        {liveUrl && (
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline w-fit">
            웹사이트에서 보기 ↗
          </a>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="페이지 주소" hint="예: goddess-idle → /games/goddess-idle" error={errorFor("slug")}>
            <input {...text("slug")} placeholder="goddess-idle" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="출시 상태" hint="서비스 중이면 다운로드 버튼, 아니면 출시 예정 카드로 보입니다.">
            <select
              value={draft.releaseStatus}
              onChange={(event) => set("releaseStatus", event.target.value as Draft["releaseStatus"])}
              className={INPUT}
            >
              {RELEASE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {RELEASE_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="목록 순서" hint="작은 숫자가 먼저 나옵니다.">
            <input
              type="number"
              value={draft.sortOrder}
              onChange={(event) => set("sortOrder", Number.parseInt(event.target.value, 10) || 0)}
              className={INPUT}
            />
          </Field>
        </div>
      </Section>

      <OneStoreImport
        gameId={page.gameId}
        url={draft.onestoreUrl}
        onUrlChange={(value) => set("onestoreUrl", value)}
        sync={draft.onestoreSync}
        onSyncChange={(value) => set("onestoreSync", value)}
        urlInvalid={invalid.includes("onestoreUrl")}
        onImported={(fields) => {
          setDraft((current) => ({ ...current, ...fields }));
          setInvalid([]);
        }}
      />

      <Section title="기본 정보">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="게임 제목" error={errorFor("titleKo")}>
            <input {...text("titleKo")} placeholder="여신키우기: 방치형 RPG" />
          </Field>
          <Field label="장르">
            <input {...text("genreKo")} placeholder="방치형 RPG" />
          </Field>
          <Field label="이용등급">
            <input {...text("ageRating")} placeholder="15세 이용가" />
          </Field>
          <Field label="개발사">
            <input {...text("developer")} placeholder="RunXuGame" />
          </Field>
        </div>
        <Field label="한 줄 소개" hint="게임 목록 카드와 상세 페이지 제목 아래에 나옵니다.">
          <input {...text("taglineKo")} placeholder="손을 떼도, 여신은 계속 강해진다." />
        </Field>
        <Field label="게임 소개" hint="스토어 상품 설명을 그대로 붙여 넣으세요. 줄바꿈이 그대로 보이고, ◆로 시작하는 줄은 소제목이 됩니다.">
          <textarea {...text("descriptionKo")} rows={14} className={`${text("descriptionKo").className} font-mono text-[13px] leading-relaxed`} />
        </Field>
      </Section>

      <Section title="다운로드와 링크" description="비워 둔 링크는 웹사이트에서 버튼이 숨겨집니다.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="원스토어" error={errorFor("onestoreUrl")}>
            <input {...text("onestoreUrl")} type="url" placeholder="https://onesto.re/0001007974" />
          </Field>
          <Field label="구글 플레이" error={errorFor("googlePlayUrl")}>
            <input {...text("googlePlayUrl")} type="url" placeholder="https://play.google.com/store/apps/details?id=…" />
          </Field>
          <Field label="앱스토어" error={errorFor("appStoreUrl")}>
            <input {...text("appStoreUrl")} type="url" placeholder="https://apps.apple.com/…" />
          </Field>
          <Field label="유튜브 트레일러 ID" error={errorFor("youtubeId")}>
            <input {...text("youtubeId")} placeholder="Ky1PVk-TXu8" spellCheck={false} />
          </Field>
          <Field label="확률 정보 페이지" hint="운영정책 탭의 '확률 정보 보기' 버튼이 이 주소로 갑니다." error={errorFor("probabilityUrl")}>
            <input {...text("probabilityUrl")} type="url" placeholder="https://…" />
          </Field>
        </div>
      </Section>

      <ImageSection page={page} />

      <Section title="공지사항" description="웹사이트 공지사항 탭은 네이버 라운지의 '공지사항' 게시판 글을 그대로 보여줍니다.">
        {loungeId ? (
          <p className="text-sm">
            연결된 라운지:{" "}
            <a
              href={`https://game.naver.com/lounge/${loungeId}/home`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              {loungeId} ↗
            </a>
            <span className="block text-xs text-muted mt-1">
              라운지에 공지를 올리면 10분 안에 웹사이트에도 나옵니다. 상세 페이지의 &lsquo;네이버 라운지 바로가기&rsquo; 버튼도 이 라운지로 연결됩니다.
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted">
            연결된 네이버 라운지가 없어 웹사이트 공지사항 탭이 비어 있습니다. 문의함 왼쪽 아래 &lsquo;네이버 라운지 연결&rsquo;에서 연결하세요.
          </p>
        )}
      </Section>

      <details className="bg-panel border border-line rounded-lg p-5 group">
        <summary className="cursor-pointer text-base font-bold">중국어·영어 (선택)</summary>
        <p className="text-xs text-muted mt-1">비워 두면 중국어·영어 페이지에도 한국어가 나옵니다.</p>
        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <Field label="제목 (중국어)"><input {...text("titleZh")} /></Field>
          <Field label="제목 (영어)"><input {...text("titleEn")} /></Field>
          <Field label="장르 (중국어)"><input {...text("genreZh")} /></Field>
          <Field label="장르 (영어)"><input {...text("genreEn")} /></Field>
          <Field label="한 줄 소개 (중국어)"><input {...text("taglineZh")} /></Field>
          <Field label="한 줄 소개 (영어)"><input {...text("taglineEn")} /></Field>
        </div>
        <div className="grid gap-4 mt-4">
          <Field label="게임 소개 (중국어)"><textarea {...text("descriptionZh")} rows={6} /></Field>
          <Field label="게임 소개 (영어)"><textarea {...text("descriptionEn")} rows={6} /></Field>
        </div>
      </details>

      <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-ground/95 backdrop-blur border-t border-line flex items-center gap-4">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-accent px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        {dirty && !saving && <span className="text-xs text-muted">저장하지 않은 변경이 있습니다.</span>}
        <StatusMessage tone={message?.tone ?? "muted"} className="text-sm">
          {message?.text}
        </StatusMessage>
      </div>
    </form>
  );
}

const IMAGE_SLOTS: Array<{ kind: Exclude<ImageKind, "screenshot">; label: string; hint: string; ratio: string }> = [
  { kind: "kv", label: "키 비주얼", hint: "상세 페이지 맨 위. 가로 4:1, 1280×320 이상 권장.", ratio: "aspect-[4/1]" },
  { kind: "card", label: "목록 카드", hint: "게임 목록에 나오는 이미지. 16:9 권장.", ratio: "aspect-video" },
];

const UPLOAD_ERRORS: Record<string, string> = {
  not_image: "이미지 파일만 올릴 수 있습니다.",
  too_large: "4MB 이하 이미지만 올릴 수 있습니다.",
  too_many: `스크린샷은 ${MAX_SCREENSHOTS}장까지 올릴 수 있습니다.`,
};

function ImageSection({ page }: { page: GamePage }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(kind: ImageKind, file: File) {
    if (!file.type.startsWith("image/")) return setError(UPLOAD_ERRORS.not_image);
    if (file.size > MAX_IMAGE_BYTES) return setError(UPLOAD_ERRORS.too_large);
    setBusy(kind);
    setError(null);
    const formData = new FormData();
    formData.set("kind", kind);
    formData.set("file", file);
    try {
      const response = await fetch(`/api/games/${page.gameId}/page/images`, { method: "POST", body: formData });
      const json: { success: boolean; error?: string } = await response.json();
      if (!json.success) setError(UPLOAD_ERRORS[json.error ?? ""] ?? "이미지를 올리지 못했습니다. 다시 시도해주세요.");
      else router.refresh();
    } catch {
      setError("이미지를 올리지 못했습니다. 다시 시도해주세요.");
    }
    setBusy(null);
  }

  async function remove(kind: ImageKind, path: string) {
    setBusy(path);
    setError(null);
    try {
      const response = await fetch(`/api/games/${page.gameId}/page/images`, {
        method: "DELETE",
        body: JSON.stringify({ kind, path }),
      });
      const json: { success: boolean } = await response.json();
      if (!json.success) setError("이미지를 지우지 못했습니다. 다시 시도해주세요.");
      else router.refresh();
    } catch {
      setError("이미지를 지우지 못했습니다. 다시 시도해주세요.");
    }
    setBusy(null);
  }

  function picker(kind: ImageKind, label: string) {
    return (
      <label className={`inline-flex items-center rounded border border-line px-3 py-1.5 text-sm cursor-pointer hover:border-accent hover:text-accent transition-colors ${busy ? "pointer-events-none opacity-60" : ""}`}>
        {busy === kind ? "올리는 중…" : label}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(kind, file);
          }}
        />
      </label>
    );
  }

  return (
    <Section title="이미지" description="올리면 바로 저장됩니다. 4MB 이하 이미지만 올릴 수 있습니다.">
      <div className="grid gap-5 sm:grid-cols-2">
        {IMAGE_SLOTS.map((slot) => {
          const path = slot.kind === "kv" ? page.kvPath : page.cardPath;
          const url = getGameSiteImageUrl(path);
          return (
            <div key={slot.kind} className="flex flex-col gap-2 min-w-0">
              <span className="text-sm font-medium">{slot.label}</span>
              <div className={`${slot.ratio} w-full rounded border border-line bg-ground overflow-hidden flex items-center justify-center`}>
                {url && !url.startsWith("/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={`${slot.label} 미리보기`} className="w-full h-full object-cover" />
                ) : url ? (
                  <span className="text-xs text-muted px-3 text-center">웹사이트 기본 이미지 사용 중<br />{url}</span>
                ) : (
                  <span className="text-xs text-muted">이미지 없음</span>
                )}
              </div>
              <span className="text-xs text-muted">{slot.hint}</span>
              <div className="flex gap-2">
                {picker(slot.kind, path ? "바꾸기" : "올리기")}
                {path && (
                  <button
                    type="button"
                    onClick={() => remove(slot.kind, path)}
                    disabled={busy !== null}
                    className="rounded px-3 py-1.5 text-sm text-muted hover:text-red-600 disabled:opacity-60"
                  >
                    {busy === path ? "지우는 중…" : "지우기"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            스크린샷 <span className="text-muted font-normal tabular-nums">{page.screenshotPaths.length}/{MAX_SCREENSHOTS}</span>
          </span>
          {page.screenshotPaths.length < MAX_SCREENSHOTS && picker("screenshot", "추가")}
        </div>
        {page.screenshotPaths.length === 0 ? (
          <p className="text-xs text-muted">스크린샷이 없으면 웹사이트에서 스크린샷 칸이 숨겨집니다.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {page.screenshotPaths.map((path, index) => {
              const url = getGameSiteImageUrl(path);
              return (
                <li key={path} className="flex flex-col gap-1 min-w-0">
                  <div className="aspect-[9/16] rounded border border-line bg-ground overflow-hidden flex items-center justify-center">
                    {url && !url.startsWith("/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={`스크린샷 ${index + 1}`} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[11px] text-muted px-2 text-center break-all">{path}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove("screenshot", path)}
                    disabled={busy !== null}
                    className="text-xs text-muted hover:text-red-600 disabled:opacity-60 text-left"
                  >
                    {busy === path ? "지우는 중…" : `${index + 1}번 지우기`}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <StatusMessage className="text-sm">{error}</StatusMessage>
    </Section>
  );
}

type ImportedFields = Partial<Pick<Draft, "onestoreUrl" | "titleKo" | "genreKo" | "ageRating" | "taglineKo" | "descriptionKo">>;

const IMPORT_ERRORS: Record<string, string> = {
  invalid_url: "원스토어 상품 주소가 아닙니다. 예: https://onesto.re/0001007974",
  not_found: "원스토어에서 이 상품을 찾지 못했습니다. 주소를 확인하세요.",
  fetch_failed: "원스토어 페이지를 읽지 못했습니다. 잠시 뒤 다시 시도하세요.",
};

/** 원스토어 주소로 제목·장르·이용등급·한 줄 소개·게임 소개를 채우고, 고르면 스크린샷·대표 이미지도 가져온다. */
function OneStoreImport({
  gameId,
  url,
  onUrlChange,
  sync,
  onSyncChange,
  urlInvalid,
  onImported,
}: {
  gameId: string;
  url: string;
  onUrlChange: (value: string) => void;
  sync: boolean;
  onSyncChange: (value: boolean) => void;
  urlInvalid: boolean;
  onImported: (fields: ImportedFields) => void;
}) {
  const router = useRouter();
  const [withImages, setWithImages] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);

  async function handleImport() {
    if (url.trim() === "") {
      setMessage({ tone: "error", text: IMPORT_ERRORS.invalid_url });
      return;
    }
    setLoading(true);
    setMessage(null);

    let json: {
      success: boolean;
      error?: string;
      warning?: string;
      product?: { url: string; title: string; genre: string | null; ageRating: string | null; tagline: string | null; description: string | null };
      imported?: { card: boolean; screenshots: number };
    };
    try {
      const response = await fetch(`/api/games/${gameId}/page/onestore`, {
        method: "POST",
        body: JSON.stringify({ url, images: withImages }),
      });
      json = await response.json();
    } catch {
      json = { success: false, error: "fetch_failed" };
    }
    setLoading(false);

    if (!json.success || !json.product) {
      setMessage({ tone: "error", text: IMPORT_ERRORS[json.error ?? ""] ?? IMPORT_ERRORS.fetch_failed });
      return;
    }

    const { product, imported } = json;
    const fields: ImportedFields = { onestoreUrl: product.url, titleKo: product.title };
    if (product.genre) fields.genreKo = product.genre;
    if (product.ageRating) fields.ageRating = product.ageRating;
    if (product.tagline) fields.taglineKo = product.tagline;
    if (product.description) fields.descriptionKo = product.description;
    onImported(fields);

    const parts = ["글을 채웠습니다. 확인한 뒤 아래 저장을 누르세요."];
    if (imported && (imported.card || imported.screenshots > 0)) {
      parts.push(`이미지는 바로 저장했습니다(${[imported.card ? "목록 카드" : null, imported.screenshots ? `스크린샷 ${imported.screenshots}장` : null].filter(Boolean).join(", ")}).`);
      router.refresh();
    }
    if (json.warning) parts.push("일부 이미지는 가져오지 못했습니다.");
    setMessage({ tone: json.warning ? "warning" : "success", text: parts.join(" ") });
  }

  return (
    <Section title="원스토어에서 불러오기" description="원스토어 상품 페이지의 제목, 장르, 이용등급, 한 줄 소개, 게임 소개를 그대로 가져와 아래 칸을 채웁니다.">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleImport();
            }
          }}
          placeholder="https://onesto.re/0001007974"
          aria-label="원스토어 상품 주소"
          aria-invalid={urlInvalid || undefined}
          className={`${INPUT} ${urlInvalid ? INPUT_INVALID : ""}`}
        />
        <button
          type="button"
          onClick={handleImport}
          disabled={loading}
          className="shrink-0 rounded border border-accent px-4 py-2 text-sm font-semibold text-accent hover:bg-accent hover:text-white disabled:opacity-60 transition-colors"
        >
          {loading ? "불러오는 중…" : "불러오기"}
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
        <input type="checkbox" checked={withImages} onChange={(event) => setWithImages(event.target.checked)} className="accent-accent" />
        스크린샷과 대표 이미지도 가져오기
        <span className="text-xs text-muted">(지금 올려 둔 스크린샷·목록 카드를 바꿉니다)</span>
      </label>
      <StatusMessage tone={message?.tone ?? "muted"} className="text-sm">
        {message?.text}
      </StatusMessage>
      <label className="flex items-center justify-between gap-4 rounded border border-line px-4 py-3 cursor-pointer">
        <span className="flex flex-col">
          <span className="font-medium text-sm">원스토어 내용 자동 반영</span>
          <span className="text-xs text-muted">
            {sync
              ? "웹사이트가 원스토어를 직접 읽어 제목, 장르, 이용등급, 게임 소개, 스크린샷을 보여줍니다. 원스토어에서 바꾸면 1시간 안에 반영되고, 원스토어를 못 읽을 때는 아래 저장된 내용을 보여줍니다."
              : "꺼져 있으면 아래 저장된 내용만 보여줍니다. 원스토어가 바뀌면 다시 불러온 뒤 저장해야 합니다."}
          </span>
          {urlInvalid && <span className="text-xs text-red-600 mt-1">자동 반영하려면 원스토어 주소를 입력하세요.</span>}
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={sync}
          onChange={(event) => onSyncChange(event.target.checked)}
          className="w-10 h-5 accent-accent cursor-pointer shrink-0"
        />
      </label>
    </Section>
  );
}
