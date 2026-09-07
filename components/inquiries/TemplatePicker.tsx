"use client";

import type { TemplateRow } from "@/lib/templates";

export default function TemplatePicker({
  templates,
  typeKey,
  onPick,
}: {
  templates: TemplateRow[];
  typeKey: string;
  onPick: (content: string) => void;
}) {
  // 해당 유형 템플릿 + 공용 템플릿(type_key가 null)만 고를 수 있다.
  const usable = templates.filter((template) => template.typeKey === null || template.typeKey === typeKey);

  if (usable.length === 0) {
    return null;
  }

  return (
    <select
      value=""
      aria-label="템플릿 선택"
      onChange={(e) => {
        const picked = usable.find((template) => template.id === e.target.value);
        if (picked) {
          onPick(picked.content);
        }
      }}
      className="bg-panel border border-line rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent transition-colors"
    >
      <option value="">템플릿 선택</option>
      {usable.map((template) => (
        <option key={template.id} value={template.id}>
          {template.title}
        </option>
      ))}
    </select>
  );
}
