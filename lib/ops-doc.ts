/**
 * 게임 생성 시 자동으로 만드는 "운영 현황" 구글 문서. AI 답변 추천이 배경
 * 설명에 쓰는 사실 자료로, 만들자마자 assistant_sources에 문서 자료로 연결된다
 * (app/api/games/route.ts).
 *
 * 서비스 계정은 Drive 저장 용량이 0이라 문서를 소유할 수 없다(2026-09-14 실측,
 * storageQuotaExceeded — 사용자 폴더 안에 만들어도 만든 쪽이 소유자라 같다).
 * 그래서 Gmail과 같은 OAuth 클라이언트로 발신 계정(help@)에 drive.file 스코프
 * refresh token(GOOGLE_DOCS_REFRESH_TOKEN)을 받아 그 계정 소유로 만들고,
 * 읽기용 서비스 계정과 만든 관리자(와 OPS_DOC_EDITORS)에게 편집자로 공유한다.
 *
 * 본문에 "(예: …)" 같은 가짜 사실을 넣지 않는다 — 모델이 그대로 답변에 옮겨
 * 적었다(2026-09-14 실측).
 */
import { google } from "googleapis";
import { loadServiceAccount, SheetError } from "@/lib/google-auth";

export const OPS_DOC_SECTIONS = [
  "현재 서비스 상태",
  "알려진 이슈와 처리 상태",
  "점검·업데이트 일정",
  "진행 중인 이벤트와 보상 지급 기준",
  "결제·환불 정책",
  "복구·보상 정책",
  "계정·이용 제한 정책",
  "자주 묻는 질문과 정해진 답",
] as const;

/** 문서를 만들고 공유하는 데 필요한 최소 스코프: 이 앱이 만든 파일만 다룬다. */
export const OPS_DOC_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

export function opsDocTitle(gameName: string): string {
  return `${gameName} 운영 현황 (AI 답변 근거)`;
}

export function opsDocBody(gameName: string): string {
  return [
    opsDocTitle(gameName),
    "",
    "[작성 안내 — 채운 뒤 이 블록은 지워도 됩니다]",
    '이 문서는 관리자 페이지 "운영 자료"에 연결되어 AI 답변 추천이 배경 설명에 쓰는 사실 자료입니다.',
    "모델은 여기 적힌 것을 그대로 사실로 답변에 씁니다. 확실한 것만, 한 줄에 하나씩, 날짜와 함께 적어 주세요.",
    "끝난 항목은 지우거나 끝에 (종료)를 붙여 주세요. 아직 적을 것이 없는 항목은 그대로 두세요.",
    "",
    ...OPS_DOC_SECTIONS.flatMap((section) => [`# ${section}`, "(아직 작성되지 않음)", ""]),
  ].join("\n");
}

/**
 * 문서를 공유할 사람: 게임을 만든 관리자 + OPS_DOC_EDITORS(쉼표 구분). 세션의
 * email 자리에 auth id가 올 수 있어(이메일 없는 계정) '@' 없는 값은 버린다.
 */
export function opsDocEditors(creatorEmail: string): string[] {
  const extra = (process.env.OPS_DOC_EDITORS ?? "").split(",");
  const seen = new Set<string>();
  const editors: string[] = [];
  for (const raw of [creatorEmail, ...extra]) {
    const email = raw.trim();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    editors.push(email);
  }
  return editors;
}

export function isOpsDocConfigured(): boolean {
  return Boolean(process.env.GOOGLE_DOCS_REFRESH_TOKEN && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
}

function opsDocAuth() {
  const refreshToken = process.env.GOOGLE_DOCS_REFRESH_TOKEN;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) throw new SheetError("not_configured");
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export interface CreatedOpsDoc {
  docId: string;
  title: string;
  url: string;
  /** 공유에 실패한 주소. 문서와 자료 연결은 그대로 두고 로그로만 남긴다. */
  unshared: string[];
}

export async function createOpsDoc(input: { gameName: string; editors: string[] }): Promise<CreatedOpsDoc> {
  const auth = opsDocAuth();
  const drive = google.drive({ version: "v3", auth });
  const title = opsDocTitle(input.gameName);

  // documents.create는 폴더를 못 정한다. Drive로 만들면 OPS_DOC_FOLDER_ID 아래에 모을 수 있다.
  const folderId = process.env.OPS_DOC_FOLDER_ID?.trim();
  const created = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: "application/vnd.google-apps.document",
      ...(folderId ? { parents: [folderId] } : {}),
    },
    fields: "id",
  });
  const docId = created.data.id;
  if (!docId) throw new SheetError("source_read_failed", "files.create returned no id");

  const docs = google.docs({ version: "v1", auth });
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: [{ insertText: { location: { index: 1 }, text: opsDocBody(input.gameName) } }] },
  });

  // 읽는 쪽(서비스 계정)을 먼저 공유해야 자료 연결 뒤 바로 읽힌다.
  const serviceEmail = loadServiceAccount()?.client_email;
  const shareWith = serviceEmail ? [serviceEmail, ...input.editors.filter((email) => email !== serviceEmail)] : input.editors;
  const unshared: string[] = [];
  for (const emailAddress of shareWith) {
    try {
      await drive.permissions.create({
        fileId: docId,
        requestBody: { type: "user", role: "writer", emailAddress },
        sendNotificationEmail: false,
      });
    } catch (error) {
      console.warn("[ops-doc] share failed", { docId, emailAddress, error });
      unshared.push(emailAddress);
    }
  }

  return { docId, title, url: `https://docs.google.com/document/d/${docId}/edit`, unshared };
}
