# 문의 상세 개편 1단계 — 접수번호 · 우선순위 · 상세 화면 재구성

- 날짜: 2026-09-02
- 상태: 승인됨 (구현 계획 작성 대기)
- 선행 문서: `2026-09-01-admin-panel-design.md`

## 배경 및 목적

관리자가 다른 CS 도구의 화면을 참고 자료로 제시했다. 그 화면과 현재 문의 상세 화면의 격차를 메우는 것이 이번 작업의 목표다. 참고 화면의 요소를 전부 옮기면 새 테이블 3개와 외부 LLM 연동까지 얽히므로, 전체를 3단계로 나누고 이 문서는 **1단계**만 다룬다.

3단계 분할:

| 단계 | 내용 |
|---|---|
| **1단계 (이 문서)** | 접수번호 `R-YYYYMMDD-NNNN`, 우선순위, 상세 화면 레이아웃 재구성, 경과 시간 표기 개선 |
| 2단계 | 내부 메모, 변경 이력(감사 로그), 답변 초안 저장 |
| 3단계 | LLM 답변 추천, 답변 템플릿 |

Gmail 답변 발송은 이미 구현되어 있다 (`lib/gmail.ts`, `app/api/inquiries/[id]/reply/route.ts`). `.env`에 `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` / `GMAIL_SENDER`를 채우면 동작하므로 이번 범위에서 새로 만들 것은 없고, 메일 제목에 접수번호를 넣는 수정만 한다.

## 범위

**포함:**

- 접수번호 `R-YYYYMMDD-NNNN` 부여 (DB 트리거) 및 기존 문의 소급 부여
- 문의 우선순위 (`urgent` / `high` / `normal` / `low`) 및 변경 API
- 문의 상세 화면을 참고 화면 구조로 재구성 (헤더 / 본문 카드 / 사이드 카드)
- 접수 정보 사이드 카드 — 고정 필드 + `meta` jsonb 자동 렌더
- 경과 시간 표기를 분 / 시간 / 일 자동 전환으로 변경 (목록·상세 공통)
- 목록의 접수번호 컬럼을 UUID 앞 8자리에서 접수번호로 교체, 검색 대상에 접수번호 추가
- 회신 메일 제목에 접수번호 삽입

**제외:**

- 내부 메모, 변경 이력, 보상 패널, 답변 초안 저장 → 2단계
- LLM 답변 추천, 답변 템플릿 → 3단계
- 담당자 배정 — 이번 단계에서 뺀다. 관리자 계정 목록의 출처(Supabase Auth 조회 vs `admins` 테이블)를 정하는 일이 딸려 오는데, 지금 결정을 서두를 이유가 없다.
- UID · 서버 · 닉네임 · 앱 버전 · 플랫폼 · 기기 전용 컬럼 신설 — `theplayplus-contact`의 폼과 API를 함께 고쳐야 하므로 별도 작업이다. 대신 `meta` 자동 렌더로 그쪽이 값을 보내기 시작하면 코드 수정 없이 화면에 나타나게 해 둔다.

## 설계 결정: 채번을 DB에서 한다

`theplayplus-contact`의 문의 접수 폼은 **이 저장소의 코드를 거치지 않고 anon 권한으로 `inquiries`에 직접 insert한다** (`0001_admin_schema.sql`의 `"Allow public insert on inquiries"` 정책). 이 사실이 채번 위치를 결정한다.

| 방식 | 판정 |
|---|---|
| Next.js API 라우트에서 채번 | 탈락. 접수 폼을 통해 들어온 문의에는 번호가 붙지 않는다. |
| 트리거에서 `count(*) + 1` | 탈락. 동시 접수 시 같은 번호가 두 건 나온다. |
| **날짜별 시퀀스 테이블 + insert 트리거** | **채택.** 누가 insert하든 DB가 번호를 붙이고, upsert의 행 잠금이 중복을 원천 차단한다. |

## 스키마 변경 (`supabase/migrations/0002_inquiry_number_and_priority.sql`)

```sql
alter table inquiries add column if not exists inquiry_no text;
alter table inquiries add column if not exists priority text not null default 'normal';

create table if not exists inquiry_number_seq (
  seq_date date primary key,
  last_seq  int  not null default 0
);
```

### 채번 트리거

```sql
create or replace function assign_inquiry_no() returns trigger as $$
declare
  d date;
  n int;
begin
  if new.inquiry_no is not null then
    return new;
  end if;
  d := (coalesce(new.created_at, now()) at time zone 'Asia/Seoul')::date;
  insert into inquiry_number_seq (seq_date, last_seq)
  values (d, 1)
  on conflict (seq_date) do update set last_seq = inquiry_number_seq.last_seq + 1
  returning last_seq into n;
  new.inquiry_no := 'R-' || to_char(d, 'YYYYMMDD') || '-' || lpad(n::text, 4, '0');
  return new;
end $$ language plpgsql;

create trigger inquiries_assign_no
  before insert on inquiries
  for each row execute function assign_inquiry_no();
```

- **RLS와 `security definer`**: `inquiry_number_seq`는 RLS를 켜고 정책을 하나도 두지 않아 anon/authenticated를 전면 차단한다. 대신 트리거 함수는 반드시 `security definer`여야 한다 — 기본값인 `security invoker`면 접수 폼의 anon insert가 트리거 안에서 이 RLS에 막혀 **문의 접수 자체가 실패한다**. 함수는 `set search_path = ''`로 두고 테이블을 스키마까지 명시한다.
- **시간대**: 날짜는 반드시 `Asia/Seoul` 기준이다. `created_at`은 `timestamptz`(UTC 저장)이므로 변환 없이 자르면 한국 시간 오전 9시 이전 접수 건이 전날로 밀린다.
- **일련번호 자리수**: 4자리 고정. 하루 10,000건을 넘으면 `lpad`가 자릿수를 늘려 `R-20260723-10001`이 되며, 포맷은 깨지지만 유일성과 정렬 순서는 유지된다. 현재 문의량에서는 발생하지 않는다.
- 트리거는 `inquiry_no`가 이미 채워진 행은 건드리지 않는다. 소급 부여를 같은 마이그레이션에서 안전하게 돌리기 위해서다.

### 기존 데이터 소급 부여

같은 마이그레이션 안에서 처리한다.

1. `inquiry_no is null`인 행을 KST 날짜별로 묶고 각 묶음 안에서 `created_at` 오름차순, 동률이면 `id` 오름차순으로 `row_number()`를 매겨 번호를 채운다.
2. `inquiry_number_seq`에 날짜별 최대 일련번호를 심어 이후 채번이 이어지게 한다.
3. 그 다음에 `alter table inquiries add constraint inquiries_inquiry_no_key unique (inquiry_no)`로 유일 제약을 건다. 순서가 중요하다 — 백필 전에 제약을 걸면 실패한다.

정렬 기준을 `created_at` + `id`로 못 박는 이유는 같은 밀리초에 들어온 두 건에도 번호가 결정적으로 배정되어, 마이그레이션을 다시 돌려도 같은 결과가 나오게 하기 위해서다.

## 애플리케이션 변경

### `lib/inquiries.ts`

`InquiryRow`에 `inquiryNo: string | null`, `priority: InquiryPriority` 추가. `InquiryPriority = "urgent" | "high" | "normal" | "low"`. `mapInquiryRow`에서 매핑.

`inquiryNo`를 nullable로 두는 이유: 트리거가 붙기 전에 삽입된 행이 이론적으로 남을 수 있고, 화면은 그 경우 `—`를 보여주고 넘어가면 된다. 없는 값 때문에 상세 화면이 통째로 죽는 쪽이 나쁘다.

### `lib/format.ts` (신규)

순수 함수만 모은다. 테스트 대상이다.

- `formatElapsed(iso: string, now?: Date): string` — 1시간 미만 `N분`, 24시간 미만 `N시간`, 그 이상 `N일`. 음수(미래 시각)는 `0분`.
- `formatReceivedAt(iso: string): string` — `InquiryMailbox.tsx`에 있던 구현을 그대로 옮겨 상세 화면과 공유한다.
- `metaEntries(meta: unknown): Array<{ key: string; value: string }>` — `meta`가 객체가 아니거나 비어 있으면 `[]`. 값이 `null`/`undefined`/빈 문자열인 키는 버린다. 객체·배열 값은 `JSON.stringify`. 알려진 키(`uid`, `server`, `nickname`, `app_version`, `platform`, `device`)는 한국어 라벨로 바꾸고 그 순서를 먼저 배치하며, 나머지는 키 이름 그대로 뒤에 붙인다.

`meta`를 `InquiryRow`에 실어 오도록 `mapInquiryRow`도 함께 확장한다.

### `app/api/inquiries/[id]/priority/route.ts` (신규)

`status/route.ts`와 같은 형태의 `PATCH`. `requireAdminSession()` → zod `z.enum(["urgent","high","normal","low"])` 검증 → `update`. 실패 코드는 각각 `unauthorized` / `invalid_priority` / `update_failed`.

### `app/api/inquiries/[id]/reply/route.ts`

조회 `select`에 `inquiry_no`를 추가하고, 제목을 `[${inquiry_no}] Re: ${title}` 로 바꾼다. `inquiry_no`가 없으면 기존처럼 `Re: ${title}`.

### 컴포넌트

`InquiryDetail.tsx`가 헤더·본문·첨부·사이드 카드를 모두 떠안으면 커지므로 나눈다.

| 파일 | 책임 |
|---|---|
| `components/inquiries/InquiryHeader.tsx` (신규) | 접수번호 + 제목, 그 아래 상태 배지 · 종류 · 유형 · 접수 시각 · 경과 |
| `components/inquiries/InquiryMetaCard.tsx` (신규) | 사이드 "접수 정보" 카드. 고정 필드 후 `metaEntries()` 결과를 이어서 렌더. 값이 없는 줄은 생략 |
| `components/inquiries/PrioritySelect.tsx` (신규) | `StatusSelect`와 같은 낙관적 갱신 + 실패 시 롤백 패턴 |
| `components/inquiries/InquiryDetail.tsx` (수정) | 문의 내용 카드, 첨부 카드, 보낸 답변 카드만 담당. 헤더와 dl은 위 두 컴포넌트로 이관 |
| `components/inquiries/InquiryMailbox.tsx` (수정) | 접수번호 컬럼, 경과 표기, 검색 대상 확대 |

### 상세 페이지 레이아웃 (`app/(admin)/inquiries/[id]/page.tsx`)

기존 `grid-cols-[2fr_1fr]`을 유지하고 내용물만 재배치한다.

```
← 목록
R-20260723-0005  자동전투 3배속 추가해주세요
[신규] 건의·피드백  건의·개선 의견  접수 2026. 07. 23. 오후 10:55 · 경과 0분

┌─ 문의 내용 ──────────────┐   ┌─ 처리 ──────────┐
│ 본문                     │   │ 상태   [신규  ▾] │
└─────────────────────────┘   │ 우선순위 [보통 ▾] │
┌─ 첨부파일 (있을 때만) ────┐   └─────────────────┘
└─────────────────────────┘   ┌─ 접수 정보 ──────┐
┌─ 답변 ───────────────────┐   │ 게임 계정         │
│ [textarea]               │   │ 회사명            │
│            [답변 발송]    │   │ 회신 이메일       │
├─ 보낸 답변 (있을 때만) ───┤   │ 접수 시각         │
└─────────────────────────┘   │ (meta 자동 렌더)  │
                              └─────────────────┘
                              ┌─ 계정 이력 ──────┐
                              └─────────────────┘
```

카드 스타일은 이미 쓰이는 `bg-panel border border-line rounded-2xl`을 따른다.

1단계에서 우선순위는 사이드 카드의 select 하나로만 노출한다. `StatusBadge`에 대응하는 `PriorityBadge`는 만들지 않는다 — 목록에 우선순위 컬럼을 넣지 않기로 했으므로 배지를 쓸 자리가 없다.

## 테스트 계획

TDD로 진행한다. 테스트를 먼저 쓰고 구현한다.

신규:

- `tests/lib/format.test.ts` — `formatElapsed`(경계값 59분/60분/23시간/24시간/미래 시각), `formatReceivedAt`(오전·오후 12시 경계), `metaEntries`(빈 객체 / null / 알려진 키 순서 / 미지의 키 / 빈 값 제거 / 중첩 객체)
- `tests/api/inquiry-priority.test.ts` — `tests/api/inquiry-status.test.ts`의 패턴을 따라 401 / 400 / 500 / 성공
- `tests/components/PrioritySelect.test.tsx` — 변경 요청 발생, 실패 시 이전 값으로 롤백, 에러 메시지 표시
- `tests/components/InquiryMetaCard.test.tsx` — 고정 필드 렌더, `meta` 값 렌더, 빈 값 생략
- `tests/components/InquiryHeader.test.tsx` — 접수번호·제목·경과 렌더, 접수번호가 `null`일 때 `—`

기존 파일 수정 (모두 이미 존재한다):

- `tests/components/InquiryDetail.test.tsx` — 헤더가 `InquiryHeader`로 빠져나가므로 제목·메타 관련 단언을 옮긴다
- `tests/components/InquiryMailbox.test.tsx` — 접수번호 표시, 접수번호로 검색, 경과 표기 변경
- `tests/api/inquiry-reply.test.ts` — 메일 제목이 `[R-...] Re: ...`인지, `inquiry_no`가 없으면 `Re: ...`로 떨어지는지
- `tests/lib/inquiries.test.ts` — `mapInquiryRow`가 `inquiry_no` · `priority` · `meta`를 매핑하는지

**SQL 트리거는 Vitest로 덮지 않는다.** 대신 로컬 Postgres 16 인스턴스에 0001 상당의 스키마(anon 역할, RLS, anon insert 정책 포함)를 세워 마이그레이션을 실제로 적용해 검증한다:

1. 문의를 연속 삽입 → 번호가 1씩 이어지는가
2. `created_at`이 한국 시간 오전 8시(UTC 전날) → 전날이 아닌 당일 날짜가 붙는가
3. 소급 부여 후 새 문의가 기존 최대 번호 다음으로 이어지는가
4. 마이그레이션을 여러 번 돌려도 오류 없이 끝나고 기존 번호가 바뀌지 않는가
5. anon 권한 insert가 RLS에 막히지 않는가 (`security definer` 경로)
6. anon이 `inquiry_number_seq`를 읽거나 변조할 수 없는가
7. 동시 삽입에서 번호가 중복되거나 빠지지 않는가

## 가정

- `inquiries.meta`에 현재 값이 들어오지 않는다는 전제로 만들되, 나중에 들어오면 코드 수정 없이 렌더된다. `meta`의 스키마는 알 수 없으므로 검증하지 않고 방어적으로 렌더한다.
- 접수번호의 접두어 `R`은 고정 문자열이다. 게임별로 다른 접두어를 쓰지 않는다 (채번이 게임 공통이므로 게임 코드를 넣으면 오히려 오해를 부른다).
- 마이그레이션은 사람이 Supabase에 직접 적용한다. 이 저장소에 마이그레이션 자동 실행 장치는 없다.
