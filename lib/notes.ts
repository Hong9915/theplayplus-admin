import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminSession } from "@/lib/require-admin-session";

export interface NoteRow {
  id: string;
  authorEmail: string;
  content: string;
  createdAt: string;
}

export interface CreateNoteInput {
  inquiryId: string;
  author: AdminSession;
  content: string;
}

export async function listNotes(supabase: SupabaseClient, inquiryId: string): Promise<NoteRow[]> {
  const { data, error } = await supabase
    .from("inquiry_notes")
    .select("id, author_email, content, created_at")
    .eq("inquiry_id", inquiryId)
    .order("created_at", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    authorEmail: row.author_email,
    content: row.content,
    createdAt: row.created_at,
  }));
}

/**
 * 이벤트 적재와 달리 실패를 삼키지 않는다. 방금 작성한 메모가 조용히
 * 사라지면 안 되므로 호출부가 사용자에게 알릴 수 있게 성공 여부를 돌려준다.
 */
export async function createNote(supabase: SupabaseClient, input: CreateNoteInput): Promise<boolean> {
  const { error } = await supabase.from("inquiry_notes").insert({
    inquiry_id: input.inquiryId,
    author_id: input.author.id,
    author_email: input.author.email,
    content: input.content,
  });
  return !error;
}
