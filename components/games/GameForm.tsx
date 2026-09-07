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
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "warning" | "error">("success");
  const [submitting, setSubmitting] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const dirty = name !== "" || ownerName !== "" || logo !== null;
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
    if (logo) {
      formData.set("logo", logo);
    }

    let json: { success: boolean; error?: string; warning?: string; game?: GameRow };
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
      fail("게임 추가에 실패했습니다. 다시 시도해주세요.");
      return;
    }

    setName("");
    setOwnerName("");
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
