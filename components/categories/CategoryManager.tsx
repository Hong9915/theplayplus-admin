"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CATEGORY_KEY_PATTERN,
  PRIORITY_OPTIONS,
  TYPE_FLAG_FIELDS,
  type CategoryGroupSetting,
  type CategoryTypeSetting,
} from "@/lib/category-settings";
import StatusMessage from "@/components/ui/StatusMessage";
import TypeForm, { typeFormValues, type TypeFormValues } from "@/components/categories/TypeForm";
import { BTN_GHOST, BTN_PRIMARY, BTN_TEXT, INPUT } from "@/components/categories/styles";

/** 한 번에 하나만 편집한다. id는 종류·유형 id, 새 유형이면 그 종류 id. */
type Editing =
  | { kind: "newGroup" }
  | { kind: "group"; id: string }
  | { kind: "newType"; groupId: string }
  | { kind: "type"; id: string }
  | null;

interface ApiResponse {
  success: boolean;
  error?: string;
  message?: string;
  fields?: string[];
}

function errorText(json: ApiResponse | null, fallback: string): string {
  if (!json) return fallback;
  if (json.message) return json.message;
  switch (json.error) {
    case "key_taken":
      return "같은 키가 이 게임에 이미 있습니다. 다른 키를 써 주세요.";
    case "invalid_input":
      if (json.fields?.includes("key")) return "키는 영어 소문자로 시작하고 영어 소문자·숫자·밑줄(_)만 쓸 수 있습니다(50자까지).";
      if (json.fields?.includes("labelKo")) return "한국어 이름을 입력해 주세요(50자까지).";
      if (json.fields?.includes("requiresAttachments")) return "첨부 필수는 첨부 허용을 켠 유형에만 쓸 수 있습니다.";
      return "입력값을 확인해 주세요.";
    case "not_found":
    case "order_mismatch":
      return "그 사이 다른 곳에서 바뀌었습니다. 새로고침한 뒤 다시 해 주세요.";
    default:
      return fallback;
  }
}

const PRIORITY_LABEL = Object.fromEntries(PRIORITY_OPTIONS.map((option) => [option.value, option.label]));

function flagSummary(type: CategoryTypeSetting): string[] {
  return TYPE_FLAG_FIELDS.filter((field) => type[field.key]).map((field) => field.label);
}

function GroupLabelsForm({
  initial,
  withKey,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial: { key: string; labelKo: string; labelZh: string; labelEn: string };
  withKey: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (values: { key: string; labelKo: string; labelZh: string; labelEn: string }) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (withKey && !CATEGORY_KEY_PATTERN.test(values.key.trim())) {
      setLocalError("키는 영어 소문자로 시작하고 영어 소문자·숫자·밑줄(_)만 쓸 수 있습니다.");
      return;
    }
    if (values.labelKo.trim() === "") {
      setLocalError("한국어 이름을 입력해 주세요.");
      return;
    }
    setLocalError(null);
    onSubmit({ ...values, key: values.key.trim() });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2.5" aria-label={withKey ? "새 종류" : `${initial.labelKo} 이름 수정`}>
      <div className={`grid grid-cols-1 gap-2.5 ${withKey ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
        {withKey && (
          <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">
            키 (만든 뒤 바꿀 수 없음)
            <input
              value={values.key}
              onChange={(e) => setValues({ ...values, key: e.target.value })}
              className={`${INPUT} font-mono`}
              autoComplete="off"
              spellCheck={false}
              placeholder="예: event"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">
          한국어 이름
          <input value={values.labelKo} onChange={(e) => setValues({ ...values, labelKo: e.target.value })} className={INPUT} autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">
          중국어 이름
          <input value={values.labelZh} onChange={(e) => setValues({ ...values, labelZh: e.target.value })} className={INPUT} autoComplete="off" placeholder="비우면 한국어로 보임" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">
          영어 이름
          <input value={values.labelEn} onChange={(e) => setValues({ ...values, labelEn: e.target.value })} className={INPUT} autoComplete="off" placeholder="비우면 한국어로 보임" />
        </label>
      </div>
      <StatusMessage className="text-sm">{localError ?? error}</StatusMessage>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={submitting} className={BTN_PRIMARY}>
          {submitting ? "저장 중…" : withKey ? "종류 추가" : "저장"}
        </button>
        <button type="button" onClick={onCancel} className={BTN_GHOST}>
          취소
        </button>
      </div>
    </form>
  );
}

function MoveButtons({ label, canUp, canDown, disabled, onMove }: { label: string; canUp: boolean; canDown: boolean; disabled: boolean; onMove: (delta: -1 | 1) => void }) {
  return (
    <span className="flex items-center shrink-0">
      <button type="button" onClick={() => onMove(-1)} disabled={disabled || !canUp} aria-label={`${label} 위로`} className={`${BTN_TEXT} !px-1.5`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
      <button type="button" onClick={() => onMove(1)} disabled={disabled || !canDown} aria-label={`${label} 아래로`} className={`${BTN_TEXT} !px-1.5`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </span>
  );
}

function DeleteControl({
  label,
  pending,
  busy,
  onAsk,
  onConfirm,
  onCancel,
}: {
  label: string;
  pending: boolean;
  busy: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // 브라우저 confirm()은 쓰지 않는다. 누르면 그 자리에 확인이 뜨는 2단계.
  if (pending) {
    return (
      <span className="flex items-center gap-1 shrink-0 text-[13px]" role="group" aria-label={`${label} 삭제 확인`}>
        <span className="text-ink-2 font-medium px-1">삭제할까요?</span>
        <button type="button" onClick={onConfirm} disabled={busy} className={`${BTN_TEXT} !text-heat-hot`}>
          예
        </button>
        <button type="button" onClick={onCancel} className={BTN_TEXT}>
          아니오
        </button>
      </span>
    );
  }
  return (
    <button type="button" onClick={onAsk} aria-label={`${label} 삭제`} className={`${BTN_TEXT} hover:!text-heat-hot`}>
      삭제
    </button>
  );
}

export default function CategoryManager({ gameId, groups }: { gameId: string; groups: CategoryGroupSetting[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(groups.length === 0 ? { kind: "newGroup" } : null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 오류는 그 일이 일어난 자리(종류·유형 id, 또는 "page")에 보인다.
  const [error, setError] = useState<{ at: string; message: string } | null>(null);

  const base = `/api/games/${gameId}/categories`;

  async function call(at: string, url: string, method: string, body: unknown, fallback: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    let json: ApiResponse | null = null;
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      json = await response.json().catch(() => null);
    } catch {
      json = null;
    }
    setBusy(false);
    if (!json?.success) {
      setError({ at, message: errorText(json, fallback) });
      return false;
    }
    router.refresh();
    return true;
  }

  function startEdit(next: Editing) {
    setError(null);
    setPendingDelete(null);
    setEditing(next);
  }

  function errorAt(at: string) {
    return error?.at === at ? error.message : null;
  }

  async function move(order: CategoryGroupSetting[]) {
    await call(
      "page",
      `${base}/order`,
      "PUT",
      { groups: order.map((group) => ({ id: group.id, typeIds: group.types.map((type) => type.id) })) },
      "순서 저장에 실패했습니다."
    );
  }

  function moveGroup(index: number, delta: -1 | 1) {
    const next = [...groups];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    void move(next);
  }

  function moveType(groupIndex: number, typeIndex: number, delta: -1 | 1) {
    const next = groups.map((group) => ({ ...group, types: [...group.types] }));
    const types = next[groupIndex].types;
    [types[typeIndex], types[typeIndex + delta]] = [types[typeIndex + delta], types[typeIndex]];
    void move(next);
  }

  async function saveType(at: string, url: string, method: "POST" | "PATCH", values: TypeFormValues) {
    const { key, ...rest } = values;
    const payload = method === "POST" ? { key, ...rest } : rest;
    if (await call(at, url, method, payload, "유형 저장에 실패했습니다.")) setEditing(null);
  }

  async function remove(at: string, url: string, fallback: string) {
    const ok = await call(at, url, "DELETE", undefined, fallback);
    setPendingDelete(null);
    if (ok) setEditing(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] text-muted max-w-[560px]">
          저장하면 웹사이트 고객센터의 접수 폼에 바로 반영됩니다. 키는 문의·답변 템플릿·우선순위 규칙이 가리키는 값이라 만든 뒤에는 바꿀 수 없습니다. 문의나 템플릿이 쓰는 유형, 유형이 남은 종류는 지울 수 없습니다.
        </p>
        {editing?.kind !== "newGroup" && (
          <button type="button" onClick={() => startEdit({ kind: "newGroup" })} className={`${BTN_PRIMARY} shrink-0`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            새 종류
          </button>
        )}
      </div>

      <StatusMessage className="text-sm">{errorAt("page")}</StatusMessage>

      {editing?.kind === "newGroup" && (
        <section className="rounded-2xl bg-panel shadow-paper p-5" aria-labelledby="group-add-title">
          <h2 id="group-add-title" className="text-[15px] font-bold tracking-[-.01em] mb-3">
            새 종류
          </h2>
          <GroupLabelsForm
            initial={{ key: "", labelKo: "", labelZh: "", labelEn: "" }}
            withKey
            submitting={busy}
            error={errorAt("newGroup")}
            onSubmit={async (values) => {
              if (await call("newGroup", `${base}/groups`, "POST", values, "종류 추가에 실패했습니다.")) setEditing(null);
            }}
            onCancel={() => startEdit(null)}
          />
        </section>
      )}

      {groups.length === 0 && editing?.kind !== "newGroup" && <p className="py-10 text-center text-[14px] text-muted">등록된 문의 종류가 없습니다.</p>}

      {groups.map((group, groupIndex) => (
        <section key={group.id} className="rounded-2xl bg-panel shadow-paper" aria-labelledby={`group-${group.id}-title`}>
          <header className="px-5 py-4 border-b border-line-soft">
            {editing?.kind === "group" && editing.id === group.id ? (
              <GroupLabelsForm
                initial={{ key: group.key, labelKo: group.labelKo, labelZh: group.labelZh ?? "", labelEn: group.labelEn ?? "" }}
                withKey={false}
                submitting={busy}
                error={errorAt(group.id)}
                onSubmit={async (values) => {
                  const { key: _key, ...labels } = values;
                  if (await call(group.id, `${base}/groups/${group.id}`, "PATCH", labels, "종류 저장에 실패했습니다.")) setEditing(null);
                }}
                onCancel={() => startEdit(null)}
              />
            ) : (
              <>
                <div className="flex items-center gap-2.5 min-w-0">
                  <h2 id={`group-${group.id}-title`} className="text-[16px] font-bold tracking-[-.01em] truncate">
                    {group.labelKo}
                  </h2>
                  <code className="shrink-0 px-1.5 rounded bg-well text-[12px] text-muted" title="키 (바꿀 수 없음)">
                    {group.key}
                  </code>
                  <span className="hidden md:inline text-[13px] text-muted truncate">
                    {[group.labelZh, group.labelEn].filter(Boolean).join(" · ")}
                  </span>
                  <span className="ml-auto" />
                  <MoveButtons
                    label={group.labelKo}
                    canUp={groupIndex > 0}
                    canDown={groupIndex < groups.length - 1}
                    disabled={busy}
                    onMove={(delta) => moveGroup(groupIndex, delta)}
                  />
                  <span className="w-px h-4 bg-line mx-1 shrink-0" aria-hidden="true" />
                  <button type="button" onClick={() => startEdit({ kind: "group", id: group.id })} aria-label={`${group.labelKo} 이름 수정`} className={BTN_TEXT}>
                    이름 수정
                  </button>
                  <DeleteControl
                    label={group.labelKo}
                    pending={pendingDelete === group.id}
                    busy={busy}
                    onAsk={() => {
                      setError(null);
                      setPendingDelete(group.id);
                    }}
                    onConfirm={() => remove(group.id, `${base}/groups/${group.id}`, "종류 삭제에 실패했습니다.")}
                    onCancel={() => setPendingDelete(null)}
                  />
                </div>
                <StatusMessage className="text-sm mt-2">{errorAt(group.id)}</StatusMessage>
              </>
            )}
          </header>

          <ul className="divide-y divide-line-soft">
            {group.types.length === 0 && <li className="px-5 py-4 text-[13.5px] text-muted">유형이 없습니다. 접수 폼에는 종류 제목만 보입니다.</li>}
            {group.types.map((type, typeIndex) => (
              <li key={type.id} className="px-5 py-3.5">
                {editing?.kind === "type" && editing.id === type.id ? (
                  <TypeForm
                    mode="edit"
                    initial={typeFormValues(type, group.id)}
                    groups={groups}
                    submitting={busy}
                    error={errorAt(type.id)}
                    onSubmit={(values) => saveType(type.id, `${base}/types/${type.id}`, "PATCH", values)}
                    onCancel={() => startEdit(null)}
                  />
                ) : (
                  <>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <p className="text-[14.5px] font-semibold truncate">{type.labelKo}</p>
                      <code className="shrink-0 px-1.5 rounded bg-well text-[12px] text-muted" title="키 (바꿀 수 없음)">
                        {type.key}
                      </code>
                      <span
                        className={`inline-flex items-center h-[20px] px-1.5 rounded-md text-[11.5px] font-semibold shrink-0 ${
                          type.defaultPriority === "urgent" ? "bg-accent-wash text-accent-ink" : "bg-line-soft text-ink-2"
                        }`}
                      >
                        우선순위 {PRIORITY_LABEL[type.defaultPriority]}
                      </span>
                      <span className="ml-auto" />
                      <MoveButtons
                        label={type.labelKo}
                        canUp={typeIndex > 0}
                        canDown={typeIndex < group.types.length - 1}
                        disabled={busy}
                        onMove={(delta) => moveType(groupIndex, typeIndex, delta)}
                      />
                      <span className="w-px h-4 bg-line mx-1 shrink-0" aria-hidden="true" />
                      <button type="button" onClick={() => startEdit({ kind: "type", id: type.id })} aria-label={`${type.labelKo} 수정`} className={BTN_TEXT}>
                        수정
                      </button>
                      <DeleteControl
                        label={type.labelKo}
                        pending={pendingDelete === type.id}
                        busy={busy}
                        onAsk={() => {
                          setError(null);
                          setPendingDelete(type.id);
                        }}
                        onConfirm={() => remove(type.id, `${base}/types/${type.id}`, "유형 삭제에 실패했습니다.")}
                        onCancel={() => setPendingDelete(null)}
                      />
                    </div>
                    <p className="mt-1 text-[12.5px] text-muted">{flagSummary(type).join(" · ") || "추가로 받는 항목 없음"}</p>
                    <StatusMessage className="text-sm mt-1.5">{errorAt(type.id)}</StatusMessage>
                  </>
                )}
              </li>
            ))}
            <li className="px-5 py-3">
              {editing?.kind === "newType" && editing.groupId === group.id ? (
                <TypeForm
                  mode="create"
                  initial={typeFormValues(null, group.id)}
                  groups={groups}
                  submitting={busy}
                  error={errorAt(`new-${group.id}`)}
                  onSubmit={(values) => saveType(`new-${group.id}`, `${base}/types`, "POST", values)}
                  onCancel={() => startEdit(null)}
                />
              ) : (
                <button type="button" onClick={() => startEdit({ kind: "newType", groupId: group.id })} className={BTN_TEXT}>
                  + {group.labelKo}에 유형 추가
                </button>
              )}
            </li>
          </ul>
        </section>
      ))}
    </div>
  );
}
