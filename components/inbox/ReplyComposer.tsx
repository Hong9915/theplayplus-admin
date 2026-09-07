"use client";

import { useState } from "react";
import type { TemplateRow } from "@/lib/templates";
import { handleTabListKeyDown, tabPanelProps, tabProps } from "@/components/ui/tabs";
import ReplyForm from "@/components/inquiries/ReplyForm";
import NoteForm from "@/components/inbox/NoteForm";

type Tab = "reply" | "note";
const TABS: readonly Tab[] = ["reply", "note"];
const TAB_PREFIX = "composer";

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
    `h-7 px-2.5 inline-flex items-center rounded-md text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
      active ? "bg-ground text-ink font-semibold" : "text-muted hover:text-ink"
    }`;

  return (
    <div className="flex flex-col gap-2.5 px-5 pt-3 pb-4 border-t border-line bg-panel">
      <div
        className="flex items-center gap-1"
        role="tablist"
        aria-label="작성 종류"
        onKeyDown={(event) => handleTabListKeyDown(event, TABS, tab, TAB_PREFIX, setTab)}
      >
        <button {...tabProps(TAB_PREFIX, "reply", tab === "reply")} onClick={() => setTab("reply")} className={tabClass(tab === "reply")}>
          답변
        </button>
        <button {...tabProps(TAB_PREFIX, "note", tab === "note")} onClick={() => setTab("note")} className={tabClass(tab === "note")}>
          내부 메모
        </button>
        {tab === "reply" && (
          <span className="ml-auto text-[11px] text-muted truncate">받는 사람 {replyEmail}</span>
        )}
      </div>
      {tab === "reply" ? (
        <div {...tabPanelProps(TAB_PREFIX, "reply")}>
          <ReplyForm inquiryId={inquiryId} initialDraft={initialDraft} templates={templates} typeKey={typeKey} />
        </div>
      ) : (
        <div {...tabPanelProps(TAB_PREFIX, "note")}>
          <NoteForm inquiryId={inquiryId} />
        </div>
      )}
    </div>
  );
}
