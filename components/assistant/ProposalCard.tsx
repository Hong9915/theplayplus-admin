"use client";

import { useState } from "react";
import { APPLY_FAILURE_MESSAGES, GENERIC_ERROR, type ChatMessage } from "@/components/assistant/messages";
import { formatReceivedAt } from "@/lib/format";

type ApplyResponse =
  | { success: true; status: "applied"; appliedBy: string; appliedAt: string }
  | { success: false; status: "failed"; failureReason: string }
  | { success: false; error: string };

/** 모델이 만든 시트 수정 제안. 관리자가 [적용]을 눌러야만 시트에 쓴다. */
export default function ProposalCard({ message, onChange }: { message: ChatMessage; onChange: (patch: Partial<ChatMessage>) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proposal = message.proposal;
  if (!proposal) return null;

  async function call(action: "apply" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/assistant/messages/${message.id}/${action}`, { method: "POST" });
      const json = (await response.json()) as ApplyResponse | { success: true; status: "cancelled" };
      if ("status" in json && json.status === "applied") {
        onChange({ status: "applied", appliedBy: json.appliedBy, appliedAt: json.appliedAt, failureReason: null });
      } else if ("status" in json && json.status === "failed") {
        onChange({ status: "failed", failureReason: json.failureReason });
      } else if ("status" in json && json.status === "cancelled") {
        onChange({ status: "cancelled" });
      } else {
        setError(GENERIC_ERROR);
      }
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-line rounded-xl bg-panel overflow-hidden text-sm" aria-label="시트 수정 제안">
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
        <span className="font-semibold">시트 수정 제안</span>
        <span className="text-muted">·</span>
        <span className="text-muted">{proposal.sheet}</span>
        {proposal.kind === "update" ? (
          <span className="text-muted">
            탭 <span className="text-ink">{proposal.row}</span>행
          </span>
        ) : (
          <span className="text-muted">탭 · 행 추가</span>
        )}
      </div>

      <table className="w-full">
        <thead className="text-xs text-muted">
          <tr>
            <th className="text-left font-medium px-4 py-1.5">열</th>
            {proposal.kind === "update" && <th className="text-left font-medium px-4 py-1.5">이전값</th>}
            <th className="text-left font-medium px-4 py-1.5">{proposal.kind === "update" ? "새값" : "값"}</th>
          </tr>
        </thead>
        <tbody>
          {proposal.kind === "update"
            ? proposal.updates.map((update) => (
                <tr key={update.column} className="border-t border-line">
                  <td className="px-4 py-1.5 font-medium">{update.column}</td>
                  <td className="px-4 py-1.5 text-muted line-through">{update.before || "(비어 있음)"}</td>
                  <td className="px-4 py-1.5">{update.after}</td>
                </tr>
              ))
            : Object.entries(proposal.values).map(([column, value]) => (
                <tr key={column} className="border-t border-line">
                  <td className="px-4 py-1.5 font-medium">{column}</td>
                  <td className="px-4 py-1.5">{value}</td>
                </tr>
              ))}
        </tbody>
      </table>

      <div className="px-4 py-2.5 border-t border-line flex items-center gap-2 bg-ground/60">
        {message.status === "pending" && (
          <>
            <button
              type="button"
              onClick={() => call("apply")}
              disabled={busy}
              className="rounded-lg bg-accent text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              적용
            </button>
            <button
              type="button"
              onClick={() => call("cancel")}
              disabled={busy}
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-ground disabled:opacity-50"
            >
              취소
            </button>
            {error && <span className="text-red-600 text-xs">{error}</span>}
          </>
        )}
        {message.status === "applied" && (
          <span className="text-emerald-700 text-xs">
            적용됨 · {message.appliedBy}{message.appliedAt ? ` · ${formatReceivedAt(message.appliedAt)}` : ""}
          </span>
        )}
        {message.status === "cancelled" && <span className="text-muted text-xs">취소됨</span>}
        {message.status === "failed" && (
          <span className="text-red-600 text-xs">
            실패 · {APPLY_FAILURE_MESSAGES[message.failureReason ?? ""] ?? GENERIC_ERROR}
          </span>
        )}
      </div>
    </div>
  );
}
