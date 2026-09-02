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
