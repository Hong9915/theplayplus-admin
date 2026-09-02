# 문의 상세 개편 2단계 — 내부 메모 · 변경 이력 · 답변 초안

- 날짜: 2026-09-02
- 상태: 승인됨 (구현 계획 작성 대기)
- 선행 문서: `2026-09-02-inquiry-detail-phase1-design.md`

## 배경 및 목적

1단계에서 문의 상세 화면을 헤더 / 본문 카드 / 사이드 카드 구조로 재구성하고 접수번호와 우선순위를 넣었다. 참고 화면에는 아직 옮기지 않은 요소가 남아 있다 — 내부 메모, 변경 이력, 답변 초안 저장. 이 문서는 그 셋을 다룬다.

이번 단계에서 처음으로 **"누가 했는가"가 필요해진다.** 지금까지 관리자 신원은 로그인 여부 확인에만 쓰였고, `requireAdminSession()`은 사용자를 조회하고도 `boolean`만 반환하며 버리고 있다. 메모 작성자와 이력 행위자를 남기려면 이 헬퍼를 넓혀야 한다.

## 범위

**포함:**

- 내부 메모 (`inquiry_notes`) — 운영자 전용, 사용자에게 노출되지 않음
- 변경 이력 (`inquiry_events`) — 상태 변경 / 우선순위 변경 / 답변 발송 / 메모 추가
- 답변 초안 저장 (`inquiries.draft_reply`)
- 관리자 신원 조회 헬퍼 `getAdminSession()`
- 행위자 표시용 순수 함수 `emailLocalPart()`

**제외:**

- LLM 답변 추천, 답변 템플릿 → 3단계
- 담당자 배정 — 1단계에서 미뤘고 여기서도 다루지 않는다. 관리자 표시이름이 필요해지는 시점에 `admins` 테이블과 함께 별도로 설계한다.
- 보상 패널 — 참고 화면에 있으나 이 저장소에 지급 수단이 없다. GM 툴 연동이 생기면 그때.
- 메모 수정·삭제. 감사 성격의 기록이라 추가만 가능하게 둔다.

## 설계 결정

### 1. 접수 이벤트는 저장하지 않고 화면에서 합성한다

참고 화면의 변경 이력 맨 아래에는 "접수 · 사용자 접수" 줄이 있다. 이걸 `inquiry_events`에 실제로 쌓으려면 1단계의 채번 트리거처럼 insert 트리거가 하나 더 필요하다 — `theplayplus-contact`가 anon으로 직접 insert하기 때문이다. 그러면 RLS와 `security definer`를 또 다뤄야 한다.

`inquiries.created_at`이 이미 그 정보를 갖고 있으므로, 이력 목록을 만들 때 화면단에서 마지막 항목으로 붙인다. 트리거 없이 같은 결과를 얻는다.

### 2. 행위자 이메일을 비정규화한다

`inquiry_notes.author_email`과 `inquiry_events.actor_email`에 이메일 문자열을 그대로 저장한다. `auth.users`를 참조해 조인하지 않는다.

- `auth.users`는 Supabase가 관리하는 보호된 스키마다. service-role 클라이언트로 매번 조인하는 것은 번거롭고 느리다.
- 감사 기록은 계정이 삭제된 뒤에도 "누가 처리했는지"가 남아야 한다. FK 조인에만 의존하면 그 정보가 사라진다.

`author_id` / `actor_id`(uuid)도 함께 남기되 FK 제약은 걸지 않는다. 나중에 관리자별 통계를 낼 때 쓸 수 있고, 제약이 없어야 계정 삭제가 이력을 막지 않는다.

### 3. 이력 적재 실패는 핵심 동작을 막지 않는다

CLAUDE.md의 규칙 — "실패해도 되는 부가 작업이 실패해도 핵심 데이터 저장은 막지 않는다" — 을 그대로 따른다. 상태 변경이 성공한 뒤 이벤트 insert가 실패하면 서버 로그에 경고만 남기고 API는 `{ success: true }`를 반환한다. 이력 한 줄 때문에 상태 변경이 롤백되는 쪽이 나쁘다.

답변 발송도 같다. 메일이 나가고 상태가 `resolved`로 바뀐 뒤 이벤트 적재가 실패해도 성공이다.

### 4. 초안 저장은 이벤트로 남기지 않는다

자주 눌리는 동작이라 이력이 도배된다. 초안은 `inquiries.draft_reply` 컬럼 하나에 덮어쓰기로 저장하고, 답변 발송이 성공하면 `null`로 비운다.

## 스키마 (`supabase/migrations/0003_inquiry_notes_and_events.sql`)

```sql
alter table inquiries add column if not exists draft_reply text;

create table if not exists inquiry_notes (
  id           uuid primary key default gen_random_uuid(),
  inquiry_id   uuid not null references inquiries(id) on delete cascade,
  author_id    uuid,
  author_email text not null,
  content      text not null,
  created_at   timestamptz not null default now()
);

create table if not exists inquiry_events (
  id           uuid primary key default gen_random_uuid(),
  inquiry_id   uuid not null references inquiries(id) on delete cascade,
  actor_id     uuid,
  actor_email  text not null,
  kind         text not null,
  from_value   text,
  to_value     text,
  created_at   timestamptz not null default now()
);

create index if not exists inquiry_notes_inquiry_id_idx  on inquiry_notes (inquiry_id, created_at);
create index if not exists inquiry_events_inquiry_id_idx on inquiry_events (inquiry_id, created_at);
```

`kind` 값: `status_changed` / `priority_changed` / `reply_sent` / `note_added`. 값 검증은 zod가 API 경계에서 하므로 DB `check` 제약은 걸지 않는다 — 3단계에서 종류가 늘어날 때 마이그레이션을 또 만들지 않기 위해서다.

**RLS:** 두 테이블 모두 RLS를 켜고 정책을 하나도 두지 않는다. 관리자 앱의 service-role 클라이언트는 RLS를 우회하고, anon/authenticated는 전면 차단된다. 1단계의 `inquiry_number_seq`와 달리 이 테이블들에 쓰는 트리거가 없으므로 `security definer` 함수는 필요 없다.

## 애플리케이션 변경

### `lib/require-admin-session.ts`

```ts
export interface AdminSession { id: string; email: string }
export async function getAdminSession(): Promise<AdminSession | null>
export async function requireAdminSession(): Promise<boolean>   // getAdminSession() !== null
```

`requireAdminSession()`을 남겨두는 이유: 게임 관련 라우트(`/api/games`, `/api/games/[gameId]`)는 행위자가 필요 없다. 그쪽까지 고칠 이유가 없다.

Supabase 사용자에게 이메일이 없는 경우(`user.email`이 `undefined`)는 이론적으로 가능하다. 그때는 `id`를 이메일 자리에 넣는다 — 이력에 빈 문자열이 남는 것보다 낫다.

### `lib/notes.ts` (신규)

```ts
export interface NoteRow { id: string; authorEmail: string; content: string; createdAt: string }
export async function listNotes(supabase, inquiryId): Promise<NoteRow[]>
export async function createNote(supabase, input: { inquiryId, authorId, authorEmail, content }): Promise<void>
```

### `lib/events.ts` (신규)

```ts
export type EventKind = "status_changed" | "priority_changed" | "reply_sent" | "note_added";
export interface EventRow {
  id: string; actorEmail: string; kind: EventKind;
  fromValue: string | null; toValue: string | null; createdAt: string;
}
export async function listEvents(supabase, inquiryId): Promise<EventRow[]>
export async function recordEvent(supabase, input): Promise<void>   // 실패해도 throw하지 않고 console.warn
```

`recordEvent`가 스스로 실패를 삼키게 만든다. 호출부마다 try/catch를 반복하면 한 군데를 빠뜨리기 쉽다.

### `lib/format.ts` 확장

```ts
export function emailLocalPart(email: string): string
```

`info@theplayplus.com` → `info`. `@`가 없으면 입력을 그대로 돌려준다.

### API 라우트

| 라우트 | 동작 |
|---|---|
| `POST /api/inquiries/[id]/notes` (신규) | 메모 추가 + `note_added` 이벤트 |
| `PUT /api/inquiries/[id]/draft` (신규) | `draft_reply` 덮어쓰기. 이벤트 없음 |
| `PATCH .../status` (수정) | 변경 전 값을 읽어 `status_changed` 이벤트 (`from`/`to`) |
| `PATCH .../priority` (수정) | 같은 방식으로 `priority_changed` |
| `POST .../reply` (수정) | 발송 성공 후 `reply_sent` 이벤트, `draft_reply`를 `null`로 |

`status` / `priority` 라우트는 지금 변경 전 값을 읽지 않는다. `from`을 남기려면 update 전에 select가 한 번 더 필요하다. 이력의 가치가 그 왕복 하나보다 크다.

### 컴포넌트

| 파일 | 책임 |
|---|---|
| `components/inquiries/InquiryNotes.tsx` (신규, client) | textarea + "메모 추가" 버튼 + 메모 목록. 본문 영역, 답변 카드 위 |
| `components/inquiries/InquiryEventLog.tsx` (신규, server) | 사이드 "변경 이력" 카드. 최신순, 맨 아래 "접수" 줄 합성 |
| `components/inquiries/ReplyForm.tsx` (수정) | `[초안 저장]` `[답변 발송]` 두 버튼, `initialDraft` 프리필 |
| `app/(admin)/inquiries/[id]/page.tsx` (수정) | 메모·이력 조회 추가, 새 카드 배치 |

이벤트 한 줄의 한국어 문구는 `lib/events.ts`의 순수 함수 `describeEvent(event): string`이 만든다. 컴포넌트에 문자열 조립을 두면 테스트가 어렵다.

- `status_changed` → `상태 접수 → 완료`
- `priority_changed` → `우선순위 보통 → 긴급`
- `reply_sent` → `답변 발송`
- `note_added` → `메모 추가`

### 레이아웃

```
┌─ 문의 내용 ──────────────┐   ┌─ 처리 ──────────┐
├─ 첨부파일 ───────────────┤   ├─ 접수 정보 ──────┤
├─ 내부 메모 ──────────────┤   ├─ 변경 이력 ──────┤   ← 신규
│  운영자 전용 · 미노출     │   │ 09.02 13:20      │
│  [textarea] [메모 추가]  │   │ 상태 접수 → 완료  │
│  · info  09.02 13:20     │   │ info             │
├─ 답변 ───────────────────┤   ├─ 계정 이력 ──────┤
│  [textarea]              │   └─────────────────┘
│  [초안 저장] [답변 발송]  │
└─────────────────────────┘
```

## 테스트 계획

TDD로 진행한다.

신규:

- `tests/lib/format.test.ts` 확장 — `emailLocalPart`(정상 / `@` 없음 / 빈 문자열)
- `tests/lib/events.test.ts` — `describeEvent` 4종, `recordEvent`가 실패를 삼키는지, `listEvents` 매핑
- `tests/lib/notes.test.ts` — `listNotes` 매핑, `createNote` 인자
- `tests/api/inquiry-notes.test.ts` — 401 / 400(빈 메모) / 메모 insert 실패 시 500 / 성공 + 이벤트 적재 / **이벤트 적재가 실패해도 200**
- `tests/api/inquiry-draft.test.ts` — 401 / 성공 / 500
- `tests/components/InquiryNotes.test.tsx` — 메모 없음 / 목록 렌더 / 제출 / 실패 시 에러
- `tests/components/InquiryEventLog.test.tsx` — 이벤트 렌더, 접수 줄 합성, 이벤트 0건일 때도 접수 줄은 나오는지

기존 수정:

- `tests/lib/require-admin-session.test.ts` — `getAdminSession` 추가, 이메일 없는 사용자 폴백
- `tests/api/inquiry-status.test.ts` / `inquiry-priority.test.ts` — 이벤트 적재, **이벤트 실패해도 200**
- `tests/api/inquiry-reply.test.ts` — `reply_sent` 이벤트, `draft_reply` 비우기
- `tests/components/ReplyForm.test.tsx` — 초안 저장 버튼, 프리필

SQL은 트리거가 없어 1단계처럼 로컬 Postgres 검증이 꼭 필요하지는 않다. 다만 마이그레이션이 재실행 가능한지는 로컬에서 한 번 확인한다.

## 가정

- 관리자 수가 적고 역할 구분이 없다. 메모·이력에 권한 필터를 걸지 않는다 — 로그인한 관리자는 모두 같은 것을 본다.
- 메모와 이력은 페이지네이션하지 않는다. 문의 한 건당 수십 줄을 넘길 일이 없다.
- 마이그레이션은 사람이 Supabase에 직접 적용한다.
