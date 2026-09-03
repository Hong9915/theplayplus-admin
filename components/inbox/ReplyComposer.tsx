"use client";

import { useState } from "react";
import type { TemplateRow } from "@/lib/templates";
import ReplyForm from "@/components/inquiries/ReplyForm";
import NoteForm from "@/components/inbox/NoteForm";

type Tab = "reply" | "note";

/** 대화 열 바닥의 작성란. 답변(이메일 발송)과 내부 메모를 탭으로 오간다. */
export default function ReplyComposer({
  inquiryId,
  replyEmail,
  initialDraft,
  templates,
  typeKey,
}: {
  inquiryId: string;
  replyEmail: string;
  initialDraft: string | null;
  templates: TemplateRow[];
  typeKey: string;
}) {
  const [tab, setTab] = useState<Tab>("reply");

  const tabClass = (active: boolean) =>
    `h-7 px-2.5 inline-flex items-center rounded-md text-xs transition-colors ${
      active ? "bg-ground text-ink font-semibold" : "text-muted hover:text-ink"
    }`;

  return (
    <div className="flex flex-col gap-2.5 px-5 pt-3 pb-4 border-t border-line bg-panel">
      <div className="flex items-center gap-1" role="tablist" aria-label="작성 종류">
        <button type="button" role="tab" aria-selected={tab === "reply"} onClick={() => setTab("reply")} className={tabClass(tab === "reply")}>
          답변
        </button>
        <button type="button" role="tab" aria-selected={tab === "note"} onClick={() => setTab("note")} className={tabClass(tab === "note")}>
          내부 메모
        </button>
        {tab === "reply" && <span className="ml-auto text-[11px] text-muted truncate">받는 사람 {replyEmail}</span>}
      </div>
      {tab === "reply" ? (
        <ReplyForm inquiryId={inquiryId} initialDraft={initialDraft} templates={templates} typeKey={typeKey} />
      ) : (
        <NoteForm inquiryId={inquiryId} />
      )}
    </div>
  );
}
