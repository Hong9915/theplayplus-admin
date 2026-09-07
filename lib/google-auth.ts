/**
 * 운영 어시스턴트가 구글 시트·문서를 읽는 서비스 계정. 시트 쓰기와 문서 읽기 스코프를
 * 한 JWT에 담아 lib/sheets.ts와 lib/docs.ts가 같이 쓴다.
 */
import { google } from "googleapis";

export type SheetErrorReason =
  | "not_configured"
  | "source_forbidden"
  | "source_not_found"
  | "sources_too_large"
  | "source_read_failed"
  | "sheet_write_failed"
  | "invalid_proposal"
  | "conflict";

export class SheetError extends Error {
  /** 어느 자료에서 났는지. loadSources가 채운다. */
  sourceTitle?: string;
  constructor(
    public readonly reason: SheetErrorReason,
    message?: string
  ) {
    super(message ?? reason);
    this.name = "SheetError";
  }
}

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/documents.readonly"];

export function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

/** 설정 안내용. 관리자가 이 주소에 자료를 공유해야 한다. */
export function serviceAccountEmail(): string | null {
  return loadServiceAccount()?.client_email ?? null;
}

export function googleAuth() {
  const account = loadServiceAccount();
  if (!account) throw new SheetError("not_configured");
  return new google.auth.JWT({ email: account.client_email, key: account.private_key, scopes: GOOGLE_SCOPES });
}
