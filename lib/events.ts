import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminSession } from "@/lib/require-admin-session";

export type EventKind = "status_changed" | "priority_changed" | "reply_sent" | "note_added";

export interface EventRow {
  id: string;
  actorEmail: string;
  kind: EventKind;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

export interface RecordEventInput {
  inquiryId: string;
  actor: AdminSession;
  kind: EventKind;
  fromValue?: string | null;
  toValue?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  new: "접수",
  in_progress: "처리중",
  resolved: "완료",
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "긴급",
  high: "높음",
  normal: "보통",
  low: "낮음",
};

function label(labels: Record<string, string>, value: string | null): string {
  if (!value) {
    return "—";
  }
  return labels[value] ?? value;
}

/** 이력 한 줄의 한국어 문구. 컴포넌트가 아니라 여기서 만들어야 테스트할 수 있다. */
export function describeEvent(event: Pick<EventRow, "kind" | "fromValue" | "toValue">): string {
  switch (event.kind) {
    case "status_changed":
      return `상태 ${label(STATUS_LABELS, event.fromValue)} → ${label(STATUS_LABELS, event.toValue)}`;
    case "priority_changed":
      return `우선순위 ${label(PRIORITY_LABELS, event.fromValue)} → ${label(PRIORITY_LABELS, event.toValue)}`;
    case "reply_sent":
      return "답변 발송";
    case "note_added":
      return "메모 추가";
  }
}

export async function listEvents(supabase: SupabaseClient, inquiryId: string): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from("inquiry_events")
    .select("id, actor_email, kind, from_value, to_value, created_at")
    .eq("inquiry_id", inquiryId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    actorEmail: row.actor_email,
    kind: row.kind as EventKind,
    fromValue: row.from_value,
    toValue: row.to_value,
    createdAt: row.created_at,
  }));
}

/**
 * 이력 적재는 부가 작업이다. 실패해도 상태 변경이나 답변 발송을 되돌리지
 * 않는다 (CLAUDE.md 규칙). 호출부마다 try/catch를 반복하면 한 군데를
 * 빠뜨리기 쉬우므로 여기서 삼킨다.
 */
export async function recordEvent(supabase: SupabaseClient, input: RecordEventInput): Promise<void> {
  try {
    const { error } = await supabase.from("inquiry_events").insert({
      inquiry_id: input.inquiryId,
      actor_id: input.actor.id,
      actor_email: input.actor.email,
      kind: input.kind,
      from_value: input.fromValue ?? null,
      to_value: input.toValue ?? null,
    });
    if (error) {
      console.warn("[events] failed to record event", { kind: input.kind, message: error.message });
    }
  } catch (error) {
    console.warn("[events] failed to record event", { kind: input.kind, error });
  }
}
