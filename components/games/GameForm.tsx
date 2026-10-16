"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { GameRow } from "@/lib/categories";
import StatusMessage from "@/components/ui/StatusMessage";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const byteFormat = new Intl.NumberFormat("ko-KR", { style: "unit", unit: "byte", unitDisplay: "short", maximumFractionDigits: 0 });
const kilobyteFormat = new Intl.NumberFormat("ko-KR", { style: "unit", unit: "kilobyte", unitDisplay: "short", maximumFractionDigits: 1 });
const megabyteFormat = new Intl.NumberFormat("ko-KR", { style: "unit", unit: "megabyte", unitDisplay: "short", maximumFractionDigits: 1 });

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return byteFormat.format(bytes);
  }
  if (bytes < 1024 * 1024) {
    return kilobyteFormat.format(bytes / 1024);
  }
  return megabyteFormat.format(bytes / (1024 * 1024));
}

const INPUT =
  "bg-panel border border-line rounded px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent transition-colors";

export default function GameForm({
  onCreated,
  onDirtyChange,
}: {
  onCreated: (game: GameRow, warning?: string) => void;
  /** 입력이 하나라도 있으면 true. 대화상자가 바깥 클릭·Esc로 닫히기 전에 확인할 때 쓴다. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"active" | "ended">("active");
  const [ownerName, setOwnerName] = useState("");
  const [loungeUrl, setLoungeUrl] = useState("");
  // 웹사이트 게임 페이지(선택). 원스토어 주소가 있으면 나머지 글·이미지는 서버가 원스토어에서 채운다.
  const [onestoreUrl, setOnestoreUrl] = useState("");
  const [onestoreSync, setOnestoreSync] = useState(true);
  const [googlePlayUrl, setGooglePlayUrl] = useState("");
  const [appStoreUrl, setAppStoreUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [releaseStatus, setReleaseStatus] = useState<"live" | "prereg" | "upcoming">("live");
  const [published, setPublished] = useState(false);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "warning" | "error">("success");
  const [submitting, setSubmitting] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const dirty =
    name !== "" || ownerName !== "" || loungeUrl !== "" || logo !== null || onestoreUrl !== "" || googlePlayUrl !== "" || appStoreUrl !== "" || slug !== "" || published;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!logo || typeof URL.createObjectURL !== "function") {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logo);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  function clearLogo() {
    setLogo(null);
    setLogoError(null);
    if (logoInputRef.current) {
      logoInputRef.current.value = "";
    }
  }

  function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    if (!picked) {
      clearLogo();
      return;
    }
    if (!picked.type.startsWith("image/")) {
      clearLogo();
      setLogoError("이미지 파일만 등록할 수 있습니다.");
      return;
    }
    if (picked.size > MAX_LOGO_BYTES) {
      clearLogo();
      setLogoError("로고 이미지는 2MB 이하만 등록할 수 있습니다.");
      return;
    }
    setLogoError(null);
    setLogo(picked);
  }

  function fail(text: string) {
    setMessageTone("error");
    setMessage(text);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    setSubmitting(true);
    setMessage(null);

    const formData = new FormData();
    formData.set("name", name);
    formData.set("status", status);
    formData.set("ownerName", ownerName);
    formData.set("loungeUrl", loungeUrl);
    formData.set("onestoreUrl", onestoreUrl);
    // 주소가 없으면 자동 반영은 의미가 없어 보내지 않는다.
    formData.set("onestoreSync", String(onestoreSync && onestoreUrl.trim() !== ""));
    formData.set("googlePlayUrl", googlePlayUrl);
    formData.set("appStoreUrl", appStoreUrl);
    formData.set("slug", slug);
    formData.set("releaseStatus", releaseStatus);
    formData.set("published", String(published));
    if (logo) {
      formData.set("logo", logo);
    }

    let json: { success: boolean; error?: string; fields?: string[]; warning?: string; game?: GameRow };
    try {
      const response = await fetch("/api/games", { method: "POST", body: formData });
      json = await response.json();
    } catch {
      setSubmitting(false);
      fail("게임 추가에 실패했습니다. 다시 시도해주세요.");
      return;
    }
    setSubmitting(false);

    if (!json.success || !json.game) {
      if (json.error === "invalid_input" && json.fields?.length) {
        setInvalidFields(json.fields);
        fail("웹사이트 칸에 표시된 값을 고친 뒤 다시 추가하세요.");
        return;
      }
      fail("게임 추가에 실패했습니다. 다시 시도해주세요.");
      return;
    }
    setInvalidFields([]);

    setName("");
    setOwnerName("");
    setLoungeUrl("");
    setOnestoreUrl("");
    setOnestoreSync(true);
    setGooglePlayUrl("");
    setAppStoreUrl("");
    setSlug("");
    setReleaseStatus("live");
    setPublished(false);
    clearLogo();

    if (json.warning === "logo_upload_failed") {
      setMessageTone("warning");
      setMessage("게임은 추가되었지만 로고 업로드에 실패했습니다. 로고는 나중에 다시 등록해주세요.");
      onCreated(json.game, json.warning);
      return;
    }

    if (json.warning === "template_seed_failed") {
      setMessageTone("warning");
      setMessage("게임은 추가되었지만 기본 답변 템플릿 생성에 실패했습니다. 답변 템플릿 화면에서 직접 추가해주세요.");
      onCreated(json.game, json.warning);
      return;
    }

    if (json.warning === "ops_doc_not_configured") {
      setMessageTone("warning");
      setMessage("게임은 추가되었지만 운영 현황 문서 자동 생성이 설정되지 않았습니다(GOOGLE_DOCS_REFRESH_TOKEN). 운영 자료 화면에서 문서를 직접 만들어 연결해주세요.");
      onCreated(json.game, json.warning);
      return;
    }

    if (json.warning === "ops_doc_failed") {
      setMessageTone("warning");
      setMessage("게임은 추가되었지만 운영 현황 문서를 만들지 못했습니다. 운영 자료 화면에서 문서를 직접 만들어 연결해주세요.");
      onCreated(json.game, json.warning);
      return;
    }

    if (json.warning === "lounge_unreachable") {
      setMessageTone("warning");
      setMessage('게임은 추가되었지만 네이버 라운지를 연결하지 못했습니다. 주소를 확인한 뒤 문의함의 "네이버 라운지 연결"에서 다시 연결해주세요.');
      onCreated(json.game, json.warning);
      return;
    }

    const siteWarnings: Record<string, string> = {
      site_onestore_failed: "게임과 웹사이트 페이지는 만들었지만 원스토어 내용을 읽지 못했습니다. '웹사이트 게임 페이지'에서 다시 불러오세요.",
      site_slug_taken: "게임은 추가되었지만 다른 게임이 이미 쓰는 페이지 주소라 웹사이트 페이지를 만들지 못했습니다. '웹사이트 게임 페이지'에서 다른 주소로 저장하세요.",
      site_page_failed: "게임은 추가되었지만 웹사이트 페이지를 저장하지 못했습니다. '웹사이트 게임 페이지'에서 다시 저장하세요.",
      site_images_failed: "게임과 웹사이트 페이지는 만들었지만 원스토어 이미지 일부를 가져오지 못했습니다. '웹사이트 게임 페이지'에서 다시 불러오세요.",
    };
    if (json.warning && siteWarnings[json.warning]) {
      setMessageTone("warning");
      setMessage(siteWarnings[json.warning]);
      onCreated(json.game, json.warning);
      return;
    }

    setMessageTone("success");
    setMessage("게임이 추가되었습니다.");
    onCreated(json.game);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-sm">
      <label className="flex flex-col gap-1">
        <span>게임명</span>
        <input name="name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} required data-autofocus className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span>상태</span>
        <select name="status" value={status} onChange={(e) => setStatus(e.target.value as "active" | "ended")} className={INPUT}>
          <option value="active">서비스중</option>
          <option value="ended">종료</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span>담당자</span>
        <input name="ownerName" autoComplete="off" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span>
          네이버 라운지 주소 <span className="text-xs text-muted">(선택)</span>
        </span>
        <input
          name="loungeUrl"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="https://game.naver.com/lounge/…/home"
          value={loungeUrl}
          onChange={(e) => setLoungeUrl(e.target.value)}
          className={INPUT}
        />
        <span className="text-xs text-muted">라운지에 유저 글·댓글이 올라오면 알려드립니다. 나중에 문의함에서 연결할 수도 있습니다.</span>
      </label>

      <div className="flex flex-col gap-1">
        <span>로고</span>
        <input
          ref={logoInputRef}
          type="file"
          name="logo"
          accept="image/*"
          aria-label="로고 이미지 파일"
          onChange={handleLogoChange}
          className="sr-only"
        />

        {logo ? (
          <div className="flex items-center gap-3 border border-line rounded-lg px-3 py-2">
            <span className="w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-ground border border-line flex items-center justify-center">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL, no remote loader needed
                <img src={logoPreview} alt="" width={40} height={40} className="w-10 h-10 object-cover" />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{logo.name}</span>
              <span className="block text-xs text-muted">{formatBytes(logo.size)}</span>
            </span>
            <button
              type="button"
              onClick={clearLogo}
              className="shrink-0 text-sm text-muted hover:text-ink px-2 py-1 rounded hover:bg-ground transition-colors"
            >
              로고 제거
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => logoInputRef.current?.click()}
            className="border border-dashed border-line rounded-lg px-3 py-4 text-sm text-muted hover:text-accent hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-colors"
          >
            이미지 선택 <span className="text-xs">(PNG · JPG, 최대 2&nbsp;MB)</span>
          </button>
        )}

        <StatusMessage className="text-sm">{logoError}</StatusMessage>
      </div>

      <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
        <legend className="text-sm font-semibold">
          웹사이트 게임 페이지 <span className="text-xs font-normal text-muted">(선택)</span>
        </legend>
        <p className="text-xs text-muted -mt-1">
          원스토어 주소를 넣으면 제목, 장르, 이용등급, 소개, 스크린샷을 원스토어에서 채웁니다. 키 비주얼과 유튜브·확률 정보는 게임을 만든 뒤 &lsquo;웹사이트 게임 페이지&rsquo;에서 넣습니다.
        </p>
        <label className="flex flex-col gap-1">
          <span>원스토어 주소</span>
          <input
            name="onestoreUrl"
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="https://onesto.re/0001007974"
            value={onestoreUrl}
            onChange={(e) => setOnestoreUrl(e.target.value)}
            aria-invalid={invalidFields.includes("onestoreUrl") || undefined}
            className={`${INPUT} ${invalidFields.includes("onestoreUrl") ? "border-red-500" : ""}`}
          />
        </label>
        {onestoreUrl.trim() !== "" && (
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={onestoreSync} onChange={(e) => setOnestoreSync(e.target.checked)} className="accent-accent mt-1" />
            <span>
              원스토어 내용 자동 반영
              <span className="block text-xs text-muted">원스토어에서 설명·스크린샷을 바꾸면 웹사이트에도 1시간 안에 반영됩니다.</span>
            </span>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span>구글 플레이 주소</span>
          <input
            name="googlePlayUrl"
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="https://play.google.com/store/apps/details?id=…"
            value={googlePlayUrl}
            onChange={(e) => setGooglePlayUrl(e.target.value)}
            aria-invalid={invalidFields.includes("googlePlayUrl") || undefined}
            className={`${INPUT} ${invalidFields.includes("googlePlayUrl") ? "border-red-500" : ""}`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>앱스토어 주소</span>
          <input
            name="appStoreUrl"
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="https://apps.apple.com/…"
            value={appStoreUrl}
            onChange={(e) => setAppStoreUrl(e.target.value)}
            aria-invalid={invalidFields.includes("appStoreUrl") || undefined}
            className={`${INPUT} ${invalidFields.includes("appStoreUrl") ? "border-red-500" : ""}`}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span>페이지 주소</span>
            <input
              name="slug"
              autoComplete="off"
              spellCheck={false}
              placeholder="goddess-idle"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              aria-invalid={invalidFields.includes("slug") || undefined}
              className={`${INPUT} ${invalidFields.includes("slug") ? "border-red-500" : ""}`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>출시 상태</span>
            <select name="releaseStatus" value={releaseStatus} onChange={(e) => setReleaseStatus(e.target.value as typeof releaseStatus)} className={INPUT}>
              <option value="live">서비스 중</option>
              <option value="prereg">사전예약 중</option>
              <option value="upcoming">출시 예정</option>
            </select>
          </label>
        </div>
        <span className="text-xs text-muted -mt-2">영문 소문자·숫자·하이픈. 웹사이트 주소가 /games/{slug || "…"} 가 됩니다.</span>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} className="accent-accent mt-1" />
          <span>
            바로 웹사이트에 공개
            <span className="block text-xs text-muted">페이지 주소가 있어야 합니다. 끄고 만든 뒤 내용을 확인하고 공개해도 됩니다.</span>
          </span>
        </label>
      </fieldset>

      <StatusMessage tone={messageTone} className="text-sm">
        {message}
      </StatusMessage>
      <button
        type="submit"
        disabled={submitting}
        className="bg-accent text-white rounded px-4 py-2 hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:opacity-50 transition-colors"
      >
        {submitting ? "추가 중…" : "게임 추가"}
      </button>
    </form>
  );
}
