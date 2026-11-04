"use client";

import { useState, type FormEvent } from "react";
import type { InquiryTypePriority } from "@/lib/categories";
import {
  CATEGORY_KEY_PATTERN,
  NEW_TYPE_FLAGS,
  PRIORITY_OPTIONS,
  TYPE_FLAG_FIELDS,
  type CategoryGroupSetting,
  type CategoryTypeFlags,
  type CategoryTypeSetting,
} from "@/lib/category-settings";
import StatusMessage from "@/components/ui/StatusMessage";
import { BTN_GHOST, BTN_PRIMARY, INPUT } from "@/components/categories/styles";

export interface TypeFormValues extends CategoryTypeFlags {
  key: string;
  groupId: string;
  labelKo: string;
  labelZh: string;
  labelEn: string;
  defaultPriority: InquiryTypePriority;
}

export function typeFormValues(type: CategoryTypeSetting | null, groupId: string): TypeFormValues {
  if (!type) {
    return { ...NEW_TYPE_FLAGS, key: "", groupId, labelKo: "", labelZh: "", labelEn: "", defaultPriority: "normal" };
  }
  const { id: _id, sortOrder: _s, labelZh, labelEn, ...rest } = type;
  return { ...rest, labelZh: labelZh ?? "", labelEn: labelEn ?? "" };
}

/**
 * 유형 하나의 추가·수정 폼. 키는 추가할 때만 입력하고, 그 뒤에는 읽기 전용으로 보인다.
 * 각 항목은 웹 접수 폼(StepDetailForm)이 그 유형에서 무엇을 묻는지 그대로 적는다.
 */
export default function TypeForm({
  mode,
  initial,
  groups,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial: TypeFormValues;
  groups: CategoryGroupSetting[];
  submitting: boolean;
  error: string | null;
  onSubmit: (values: TypeFormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<TypeFormValues>(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const prefix = mode === "create" ? `new-type-${initial.groupId}` : `type-${initial.key}`;
  const moved = mode === "edit" && values.groupId !== initial.groupId;

  function setFlag(key: keyof CategoryTypeFlags, checked: boolean) {
    setValues((current) => {
      const next = { ...current, [key]: checked };
      // 첨부 필수는 첨부 허용이 켜져 있어야 뜻이 있다.
      if (key === "allowAttachments" && !checked) next.requiresAttachments = false;
      return next;
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (mode === "create" && !CATEGORY_KEY_PATTERN.test(values.key.trim())) {
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" aria-label={mode === "create" ? "새 유형" : `${initial.labelKo} 수정`}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {mode === "create" ? (
          <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">
            키 (만든 뒤 바꿀 수 없음)
            <input
              value={values.key}
              onChange={(e) => setValues({ ...values, key: e.target.value })}
              className={`${INPUT} font-mono`}
              autoComplete="off"
              spellCheck={false}
              placeholder="예: coupon_inquiry"
            />
          </label>
        ) : (
          <div className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">
            키
            <span className="h-[38px] flex items-center px-3 rounded-[10px] bg-well font-mono text-[13.5px] text-muted" aria-label="키 (바꿀 수 없음)">
              {values.key}
            </span>
          </div>
        )}
        <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">
          종류
          <select value={values.groupId} onChange={(e) => setValues({ ...values, groupId: e.target.value })} className={`${INPUT} appearance-none pr-8 select-chevron`}>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.labelKo}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">
          기본 우선순위
          <select
            value={values.defaultPriority}
            onChange={(e) => setValues({ ...values, defaultPriority: e.target.value as InquiryTypePriority })}
            className={`${INPUT} appearance-none pr-8 select-chevron`}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {moved && <p className="text-[13px] text-amber-700">다른 종류로 옮기면 그 종류의 맨 뒤에 붙습니다. 이미 접수된 문의는 원래 종류로 남습니다.</p>}

      <fieldset className="flex flex-col gap-1">
        <legend className="text-[13px] font-medium text-ink-2 mb-1">접수 폼에서 받을 항목</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5">
          {TYPE_FLAG_FIELDS.map((field) => {
            const disabled = field.key === "requiresAttachments" && !values.allowAttachments;
            const id = `${prefix}-${field.key}`;
            return (
              <div key={field.key} className={`flex items-start gap-2 ${disabled ? "opacity-50" : ""}`}>
                <input
                  id={id}
                  type="checkbox"
                  checked={values[field.key]}
                  disabled={disabled}
                  onChange={(e) => setFlag(field.key, e.target.checked)}
                  aria-describedby={`${id}-hint`}
                  className="mt-[3px] w-4 h-4 accent-accent shrink-0"
                />
                <label htmlFor={id} className="flex flex-col text-[13.5px]">
                  <span className="font-medium text-ink">{field.label}</span>
                  <span id={`${id}-hint`} className="text-[12.5px] text-muted">
                    {field.hint}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>

      <StatusMessage className="text-sm">{localError ?? error}</StatusMessage>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={submitting} className={BTN_PRIMARY}>
          {submitting ? "저장 중…" : mode === "create" ? "유형 추가" : "저장"}
        </button>
        <button type="button" onClick={onCancel} className={BTN_GHOST}>
          취소
        </button>
      </div>
    </form>
  );
}
