import type { InquiryRow } from "@/lib/inquiries";

export interface MetaEntry {
  key: string;
  label: string;
  value: string;
}

const META_LABELS: Record<string, string> = {
  uid: "UID",
  server: "서버",
  nickname: "닉네임",
  app_version: "앱 버전",
  platform: "플랫폼",
  device: "기기",
};

const META_ORDER = Object.keys(META_LABELS);

/** 접수 후 지난 시간. 1시간 미만은 분, 24시간 미만은 시간, 그 이상은 일. */
export function formatElapsed(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 60) {
    return `${minutes}분`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}시간`;
  }
  return `${Math.floor(hours / 24)}일`;
}

/** "2026. 07. 23. 오후 10:55" */
export function formatReceivedAt(iso: string): string {
  const date = new Date(iso);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hours = date.getHours();
  const meridiem = hours < 12 ? "오전" : "오후";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}. ${mm}. ${dd}. ${meridiem} ${hour12}:${min}`;
}

/**
 * 접수 폼의 datetime-local 값("2026-09-03T14:05")을 접수 시각과 같은 모양으로.
 * 시간대 정보가 없는 문자열이라 Date로 해석하지 않고 글자만 재배열한다.
 * 그 모양이 아니면 원문 그대로 돌려준다.
 */
export function formatOccurredAt(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) {
    return value;
  }
  const [, yyyy, mm, dd, hh, min] = match;
  const hours = Number(hh);
  const meridiem = hours < 12 ? "오전" : "오후";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${yyyy}. ${mm}. ${dd}. ${meridiem} ${hour12}:${min}`;
}

const LOCALE_LABELS: Record<string, string> = {
  ko: "한국어",
  zh: "중국어",
  en: "영어",
};

/**
 * inquiries.meta는 theplayplus-contact가 넣는 값이라 스키마를 알 수 없다.
 * 검증하지 않고 방어적으로 렌더 가능한 목록만 뽑아낸다.
 */
export function metaEntries(meta: unknown): MetaEntry[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return [];
  }

  const record = meta as Record<string, unknown>;
  const presentKeys = Object.keys(record);
  const known = META_ORDER.filter((key) => presentKeys.includes(key));
  const unknown = presentKeys.filter((key) => !META_ORDER.includes(key)).sort();

  const entries: MetaEntry[] = [];
  for (const key of [...known, ...unknown]) {
    const raw = record[key];
    if (raw === null || raw === undefined) {
      continue;
    }
    const value = typeof raw === "object" ? JSON.stringify(raw) : String(raw);
    if (value.trim() === "") {
      continue;
    }
    entries.push({ key, label: META_LABELS[key] ?? key, value });
  }
  return entries;
}

/** 이력·메모의 행위자 표시용. info@theplayplus.com → info */
export function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

function presentRows(rows: Array<{ label: string; value: string | null }>): MetaEntry[] {
  return rows
    .filter((row) => row.value && row.value.trim() !== "")
    .map((row) => ({ key: row.label, label: row.label, value: row.value as string }));
}

/**
 * 유형별 추가 항목(발생 일시·결제번호·기기/사양). 접수 폼이 유형 플래그에 따라
 * 채우는 컬럼이라 유형마다 있는 것만 나온다. 대화 말풍선과 접수 정보가 같이 쓴다.
 */
export function inquiryDetailRows(
  inquiry: Pick<InquiryRow, "occurredAt" | "paymentNo" | "deviceInfo">
): MetaEntry[] {
  return presentRows([
    { label: "발생 일시", value: inquiry.occurredAt ? formatOccurredAt(inquiry.occurredAt) : null },
    { label: "결제번호", value: inquiry.paymentNo },
    { label: "기기/사양", value: inquiry.deviceInfo },
  ]);
}

/** 상세 패널 "접수 정보"의 행. 값이 빈 고정 항목은 건너뛰고 meta는 metaEntries 순서를 따른다. */
export function inquiryMetaRows(inquiry: InquiryRow): MetaEntry[] {
  return [
    ...presentRows([
      { label: "게임 계정", value: inquiry.gameAccount },
      { label: "회사명", value: inquiry.companyName },
      { label: "회신 이메일", value: inquiry.replyEmail },
      { label: "언어", value: inquiry.locale ? LOCALE_LABELS[inquiry.locale] ?? inquiry.locale : null },
      { label: "접수 시각", value: formatReceivedAt(inquiry.createdAt) },
    ]),
    ...inquiryDetailRows(inquiry),
    ...metaEntries(inquiry.meta),
  ];
}
