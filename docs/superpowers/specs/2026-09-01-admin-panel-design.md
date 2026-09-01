# 관리자 페이지(Admin Panel) 설계

- 날짜: 2026-09-01
- 상태: 승인됨 (구현 계획 작성 대기)

## 배경 및 목적

`theplayplus-contact` 저장소는 `/contact` 문의 접수 폼을 만들고 있으며, 그 설계 문서에서 관리자 페이지는 범위 밖으로 명시하되 나중에 바로 연동할 수 있도록 데이터 구조를 열어뒀다. 이 저장소(`theplayplus-admin`)가 바로 그 관리자 페이지다.

핵심 요구사항은 세 가지다:
1. 게임을 추가하고 선택할 수 있어야 한다 (지금은 게임이 "여신키우기" 1개뿐이지만, 앞으로 늘어난다).
2. 게임을 선택하면 그 게임에 들어온 문의들을 쫙 볼 수 있어야 한다.
3. 문의를 보낸 계정이 이전에 어떤 문의를 했었는지 한 번에 확인할 수 있어야 한다.

나머지 세부 기능(상태 변경, 답변 발송 등)은 이번 설계 과정에서 함께 확정했다.

## 범위

**포함:**
- Supabase Auth 기반 관리자 로그인 (여러 관리자 계정 가능, 역할 구분 없음)
- 게임 추가/목록 (이름, 상태, 로고, 게임별 문의 카테고리)
- 게임 선택 → 게임별 문의 목록 (상태 필터)
- 문의 상세 조회 + 상태 변경(new/in_progress/resolved)
- Gmail API를 통한 답변 이메일 발송 (`info@theplayplus.com` 계정으로 발송, 발송 성공 시 상태 자동 완료 처리)
- 계정 이력 패널: 같은 게임 내 동일 `game_account`의 과거 문의 목록
- `theplayplus-contact`의 문의 카테고리 설정을 하드코딩 파일에서 DB(`games`/`inquiry_groups`/`inquiry_types`)로 이전 (이 저장소가 스키마의 소유자, `theplayplus-contact`는 읽기만 함)

**제외 (추후 별도 작업):**
- 이벤트 참여 이력 (데이터 소스가 아직 없음 — 확장 지점만 마련)
- 관리자 계정별 접근 권한 제어 (게임별 담당자 필드는 표시용일 뿐, 실제 권한 제한 없음)
- 다국어 관리자 UI (한국어 전용)
- 메인 사이트 저장소로의 실제 배포/머지

## 전체 구조

`theplayplus-contact`와 같은 스택(Next.js App Router + Tailwind)으로 만들어 나중에 그대로 메인 사이트에 복사해 붙여넣을 수 있게 한다. **Supabase 프로젝트는 `theplayplus-contact`와 동일한 것을 공유한다** — 두 저장소가 별도 코드베이스라도 데이터는 하나의 DB에 있어야 문의폼에서 넣은 데이터를 관리자 페이지가 바로 읽을 수 있다.

```
app/
  login/
    page.tsx                    -- 관리자 로그인 (Supabase Auth)
  games/
    page.tsx                    -- 게임 목록 + 추가 폼
    [gameId]/
      inquiries/
        page.tsx                -- 게임별 문의 목록 (상태 필터)
  inquiries/
    [id]/
      page.tsx                  -- 문의 상세 + 상태변경 + 답변발송 + 계정이력 패널
  api/
    games/
      route.ts                  -- POST: 게임 생성
    inquiries/
      [id]/
        status/
          route.ts               -- PATCH: 상태 변경
        reply/
          route.ts               -- POST: 답변 발송 (Gmail API) + 상태 자동 완료
components/
  games/
    GameForm.tsx                -- 게임 추가 폼 (이름/상태/로고/카테고리 초기값)
    GameList.tsx
  inquiries/
    InquiryList.tsx
    InquiryDetail.tsx
    StatusSelect.tsx
    ReplyForm.tsx
    AccountHistoryPanel.tsx     -- 같은 game_id + game_account 문의 목록
lib/
  supabase.ts                   -- Supabase 서버 클라이언트 (service role)
  supabase-browser.ts           -- Supabase 클라이언트 (Auth 세션용)
  gmail.ts                      -- Gmail API 클라이언트 + 발송 함수
  categories.ts                 -- games/inquiry_groups/inquiry_types 조회 헬퍼
  account-history.ts            -- 계정 이력 조회 헬퍼
middleware.ts                   -- 미인증 접근 시 /login 리다이렉트
```

디자인은 기존 사이트의 다크 테마(`#0a0a0a` 배경, `#EA581F` 포인트 컬러)를 그대로 따른다.

## 데이터 모델 (Supabase / Postgres, `theplayplus-contact`와 공유)

```sql
create table games (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  status       text not null default 'active',  -- active | ended
  logo_path    text,                              -- Supabase Storage 경로, nullable
  owner_name   text,                               -- 담당자 표시용, nullable
  created_at   timestamptz not null default now()
);

create table inquiry_groups (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references games(id) on delete cascade,
  key          text not null,       -- game_usage | business | other 등
  label        text not null,
  sort_order   int not null default 0
);

create table inquiry_types (
  id                      uuid primary key default gen_random_uuid(),
  group_id                uuid not null references inquiry_groups(id) on delete cascade,
  key                     text not null,
  label                   text not null,
  requires_game_account   boolean not null default false,
  requires_company_name   boolean not null default false,
  allow_attachments       boolean not null default false,
  sort_order              int not null default 0
);

create table inquiries (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references games(id),
  locale         text not null default 'ko',
  group_key      text not null,
  type_key       text not null,
  game_account   text,
  company_name   text,
  reply_email    text not null,
  title          text not null,
  content        text not null,
  status         text not null default 'new',   -- new | in_progress | resolved
  reply_content  text,                            -- 관리자가 보낸 답변 본문, nullable
  replied_at     timestamptz,                     -- nullable
  meta           jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

create table inquiry_attachments (
  id             uuid primary key default gen_random_uuid(),
  inquiry_id     uuid not null references inquiries(id) on delete cascade,
  file_path      text not null,
  file_name      text not null,
  created_at     timestamptz not null default now()
);
```

- `game_usage` 그룹의 유형(`account_login`, `payment_refund`, `bug_report`, `general`)은 게임 생성 시 기본 템플릿으로 자동 복사되고, 이후 관리자가 게임별로 그룹/유형을 수정할 수 있다. 기본 템플릿 자체는 `lib/categories.ts`에 시드 데이터로 정의한다.
- `inquiries.game_account`가 채워지는 유형(`requires_game_account = true`)에서만 계정 이력 매칭이 의미가 있다.
- Storage 버킷: `game-logos`(공개 읽기, 관리자만 쓰기), `inquiry-attachments`(비공개, 관리자만 서명 URL로 접근 — `theplayplus-contact`가 이미 정의한 버킷 재사용).
- RLS: `games`, `inquiry_groups`, `inquiry_types`, `inquiries`, `inquiry_attachments` 모두 인증된(Supabase Auth) 사용자만 select/update 가능, anon 키는 `inquiries`/`inquiry_attachments`에 insert만 가능(문의폼용, 기존 정책 유지), `games`/`inquiry_groups`/`inquiry_types`는 anon 키로 select만 가능(문의폼이 게임/카테고리 목록을 읽어야 하므로).

## 계정 이력 매칭 규칙

문의 상세 페이지에서 현재 문의의 `game_id` + `game_account`가 같은 다른 문의를 `created_at desc`로 조회해 사이드 패널에 표시한다 (제목, 상태, 접수일, 그룹/유형). 게임마다 계정 체계가 다르므로 **같은 게임 내에서만** 매칭하며, `game_account`가 비어 있는 문의(사업 제휴/기타 문의 등)는 이력 매칭 대상에서 제외한다.

이벤트 참여 이력은 현재 데이터 소스가 없어 이번 범위에서 제외하되, `AccountHistoryPanel` 컴포넌트에 별도 섹션 자리를 비워두고 주석으로 확장 지점을 표시한다 (예: 나중에 `event_participants` 테이블이 생기면 `game_id + game_account`로 동일하게 조인).

## 기능별 흐름

1. **로그인** — Supabase Auth 이메일/비밀번호 로그인. 미인증 상태로 `/games` 이하 접근 시 미들웨어가 `/login`으로 리다이렉트.
2. **게임 추가** — 이름/상태 입력(필수), 로고 업로드(선택), 저장 시 기본 카테고리 템플릿을 `inquiry_groups`/`inquiry_types`에 복사. 게임 목록에서 로고+이름+상태+담당자를 카드로 표시.
3. **게임별 문의 목록** — 게임 선택 후 상태 필터(전체/new/처리중/완료)로 문의를 조회, 최신순 정렬.
4. **문의 상세** — 문의 원본 내용 + 첨부파일(있으면 서명 URL) + 상태 변경 셀렉트 + 답변 작성 폼 + 계정 이력 패널을 한 화면에 표시.
5. **답변 발송** — 답변 텍스트를 작성해 제출하면 서버가 Gmail API로 `reply_email`에 발송하고, 성공 시 `inquiries.status = 'resolved'`, `reply_content`, `replied_at`을 갱신. 실패 시 상태는 그대로 두고 에러 메시지를 보여주며 재시도 가능.
6. **상태 수동 변경** — 답변 발송과 별개로, 상태만 직접 바꾸는 것도 가능 (예: 처리중으로 표시).

## Gmail API 연동

- `googleapis` 패키지로 `info@theplayplus.com` Google Workspace 계정의 Gmail API를 사용해 발송한다.
- 필요한 환경변수: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER=info@theplayplus.com`. 이 값들은 `.env`에만 두고 어떤 문서나 커밋에도 평문으로 남기지 않는다.
- refresh token은 최초 1회 OAuth 동의 화면을 통해 해당 Gmail 계정 소유자가 직접 발급해야 한다 (이 저장소 코드로 자동화되지 않는 수동 준비 단계).
- 메일 본문은 RFC 2822 형식으로 구성해 base64url 인코딩 후 `gmail.users.messages.send`로 전송한다.

## 에러 처리

- 미인증 접근 → `/login` 리다이렉트
- 게임 생성: 이름/상태 누락 → 클라이언트 검증으로 우선 차단, 서버 재검증 후 400
- 로고 업로드 실패 → 게임 생성 자체는 막지 않고, 로고 없이 저장 + 경고 표시 (문의폼의 첨부파일 실패 처리와 동일한 패턴)
- Gmail 발송 실패(인증 만료, 네트워크 오류 등) → 상태 변경 없이 500 응답 + "발송 실패, 다시 시도해주세요" 메시지, 입력한 답변 내용은 폼에 유지
- Supabase 쓰기 실패 → 500 + 재시도 가능한 에러 메시지

## 테스트 계획

- `theplayplus-contact`와 동일하게 Vitest + React Testing Library 사용
- 단위: 계정 이력 조회 헬퍼(같은 game_id/game_account 매칭, game_account 없는 문의 제외), 카테고리 템플릿 복사 로직, Gmail 클라이언트(googleapis 모킹)
- 통합: `POST /api/games`(정상 생성, 필수값 누락, 로고 업로드 실패), `PATCH /api/inquiries/[id]/status`, `POST /api/inquiries/[id]/reply`(발송 성공/실패에 따른 상태 반영)
- 컴포넌트: `GameForm` 검증, `InquiryList` 필터, `AccountHistoryPanel` 렌더링(이력 있음/없음)
- 수동 확인: 실제 Supabase 프로젝트에서 게임 추가 → (문의폼에서 그 게임 선택해 문의 접수, `theplayplus-contact` 쪽 작업 완료 후) → 관리자에서 조회 → 상태 변경 → 답변 발송까지 엔드투엔드 1회 확인
