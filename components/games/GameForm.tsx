"use client";

import { useState, type FormEvent } from "react";

export default function GameForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"active" | "ended">("active");
  const [ownerName, setOwnerName] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

    let json: { success: boolean; logoWarning?: string };
    try {
      const response = await fetch("/api/games", { method: "POST", body: formData });
      json = await response.json();
    } catch {
      setSubmitting(false);
      setMessage("게임 추가에 실패했습니다. 다시 시도해주세요.");
      return;
    }
    setSubmitting(false);

    if (!json.success) {
      setMessage("게임 추가에 실패했습니다. 다시 시도해주세요.");
      return;
    }

    if (json.logoWarning) {
      setMessage(`게임은 저장됐지만 로고 업로드에 실패했습니다: ${json.logoWarning}`);
    } else {
      setMessage("게임이 추가되었습니다.");
    }

    setName("");
    setOwnerName("");
    setLogo(null);
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-sm">
      <label className="flex flex-col gap-1">
        <span>게임명</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="bg-black border border-white/20 rounded px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>상태</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "active" | "ended")}
          className="bg-black border border-white/20 rounded px-3 py-2"
        >
          <option value="active">서비스중</option>
          <option value="ended">종료</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span>담당자</span>
        <input
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          className="bg-black border border-white/20 rounded px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>로고</span>
        <input type="file" accept="image/*" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
      </label>
      {message && <p className="text-sm">{message}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
      >
        게임 추가
      </button>
    </form>
  );
}
