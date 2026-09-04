# 서비스 문의(제휴·기타) 인박스 설계

작성일: 2026-09-04

## 배경

접수 폼(`theplayplus-contact`)의 "서비스 문의 (제휴·기타)" 경로는 이미 운영 중이다. 게임을 고르지 않고 접수한 문의는 `inquiries.game_id = null`로 저장되고, 카테고리는 전역 테이블 `service_groups`/`service_types`(사업 제휴: 퍼블리싱·마케팅·투자 / 기타: 언론·보도·일반)에서 온다. 접수 폼 쪽 마이그레이션(`0002_nullable_game_id`, `0003_service_categories`)은 공유 Supabase 프로젝트에 이미 적용돼 있다.

관리자 쪽에는 이 문의를 보는 화면이 없다(PRD U1). 게임 없이 들어온 문의는 어느 문의함에도 나타나지 않고, Slack 알림 라우트는 `game_id`를 필수 문자열로 검사해 서비스 문의를 400으로 거절한다.

## 목표

- 게임 레일 맨 위에 "서비스 문의" 항목을 하나 두고, 누르면 기존 인박스 4단 화면이 `game_id is null`인 문의로 열린다.
- 목록·필터·정렬·검색·이전/다음·상태 일괄 변경·답변 발송·회신 확인·내부 메모·처리 기록은 게임 문의와 같은 코드로 동작한다.
- 서비스 문의에는 의미 없는 것(계정 이력, 같은 계정 이어보기, 게임 삭제, 서비스중/종료 배지, 답변 템플릿)은 뺀다.
- 서비스 문의도 Slack 알림을 받는다.

## 범위 밖

- `service_groups`/`service_types` 편집 UI. 최초 설계(2026-09-01 추가 절)대로 Supabase에서 직접 관리한다.
- 서비스 문의용 답변 템플릿. 2026-09-04 결정: 이번엔 템플릿 없이 간다. `reply_templates.game_id`는 not null 그대로 두고, 서비스 문의의 답변 작성란에는 템플릿 선택을 보이지 않는다.
- 게임 레일 항목의 순서 변경·숨김 등 레일 자체의 다른 개선.

## 핵심 개념: 인박스 스코프

인박스가 다루는 범위를 "게임 하나" 또는 "서비스 문의"로 일반화한다.

```ts
// lib/inbox-scope.ts
export type InboxScope = { kind: "game"; gameId: string } | { kind: "service" };

export const SERVICE_SCOPE: InboxScope = { kind: "service" };

/** URL의 첫 세그먼트. 게임은 /games/{id}, 서비스는 /service. */
export function scopeBasePath(scope: InboxScope): string;

/** 스코프가 게임이면 game_id 값, 서비스면 null. DB 쿼리·RPC 인자용. */
export function scopeGameId(scope: InboxScope): string | null;
```

URL 헬퍼(`lib/inquiry-filters.ts`)의 `inquiryListHref`·`inquiryHref`·`inboxHref`·`legacyInquiryRedirectHref`는 첫 인자를 `gameId: string`에서 `scope: InboxScope`로 바꾼다. 게임 스코프의 결과 URL은 지금과 같다. 서비스 스코프는 `/service/inquiries[/{inquiryId}]?…`이다. 호출하는 컴포넌트(`InboxList`, `InboxSearch`, `InboxPrevNext`, `InboxNav`, `InboxShell`, `InboxConversation`)도 `gameId` prop 대신 `scope`를 받는다.

`InquiryRow.gameId`는 `string | null`이 된다. 서비스 문의 행은 `gameId: null`, `gameAccount: null`이다.

## 데이터 조회

`lib/inquiries.ts`

- `applyFilters`의 첫 인자를 `scope: InboxScope`로. 게임이면 `eq("game_id", id)`, 서비스면 `is("game_id", null)`. `FilterBuilder` 인터페이스에 `is(column, value: null)`를 추가한다.
- `queryInquiries`, `listInquiryIds`는 그대로 `scope`를 넘긴다.
- `getInquiryFacetCounts(supabase, scope)`는 RPC에 `p_game_id: scopeGameId(scope)`를 넘긴다.
- `countNewInquiriesByGame`은 `game_id` null 행을 건너뛰는 대신 예약 키 `"service"`로 센다. 반환 타입은 그대로 `Record<string, number>`이고, `SERVICE_RAIL_KEY = "service"` 상수를 `lib/inbox-scope.ts`에 둔다(게임 id는 uuid라 충돌하지 않는다).

`supabase/migrations/0009_service_inquiry_facets.sql`

```sql
-- p_game_id가 null이면 게임 없는(서비스) 문의를 센다. 0008과 서명이 같아 create or replace로 덮어쓴다.
create or replace function inquiry_facet_counts(p_game_id uuid)
returns table (facet text, key text, count bigint)
language sql
stable
as $$
  with scoped as (
    select * from inquiries where game_id is not distinct from p_game_id
  )
  select 'status'::text, status::text, count(*) from scoped group by status
  union all
  select 'type', type_key, count(*) from scoped group by type_key
  union all
  select 'priority', coalesce(priority, 'normal'), count(*) from scoped group by 2
  union all
  select 'stale', '1', count(*) from scoped
    where status <> 'resolved' and created_at < now() - interval '72 hours'
  union all
  select 'total', 'all', count(*) from scoped
$$;
```

`is not distinct from`는 null끼리도 같다고 보므로 게임 uuid와 null을 한 함수로 처리한다. 권한 설정(0008)은 유지된다.

`supabase/migrations/0009`와 별도로 `supabase/migrations/0010_service_categories.sql`에 접수 폼 저장소의 `0003_service_categories.sql`을 그대로 복사해 둔다. 이미 적용된 DB에서는 `if not exists`/`on conflict do nothing`으로 아무 일도 하지 않으며, 이 저장소만 보고도 스키마를 알 수 있게 하는 기록 목적이다.

`lib/categories.ts`

- `listServiceCategoryLabels(supabase): Promise<CategoryLabelMaps>`를 추가한다. `service_groups`/`service_types`를 `sort_order` 순으로 읽어 `listCategoryLabels`와 같은 모양(`groupLabels`, `typeLabels`, `typeOrder`)으로 돌려준다. 실패하면 빈 맵.
- `listCategoryLabelsForScope(supabase, scope)`가 스코프에 따라 둘 중 하나를 부른다. 페이지·알림 라우트·답변 라우트는 이 함수를 쓴다.

## 라우트

`app/(admin)/service/inquiries/[[...inquiryId]]/page.tsx`

기존 `app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx`의 본문을 `lib/inbox-page.ts`(서버 전용)의 `loadInboxPage(scope, inquiryId, searchParams)`로 옮기고, 두 페이지는 스코프만 정해 이 함수를 부른다. 게임 페이지는 지금처럼 `listGames`로 게임을 찾아 없으면 `notFound()`. 서비스 페이지는 게임 조회가 없다.

`loadInboxPage`의 서비스 스코프 분기:

- 선택한 문의의 `gameId`가 스코프와 맞지 않으면 `notFound()`. 서비스 스코프에서는 `gameId === null`이어야 하고, 게임 스코프에서는 `gameId === params.gameId`여야 한다.
- 계정 이력(`getAccountHistory`)과 그로부터 만드는 `pastThreads`는 서비스 스코프에서 호출하지 않고 빈 배열로 둔다. `getAccountHistory`의 `gameId` 인자는 `string` 그대로 두고, 호출부에서 게임 스코프일 때만 부른다.
- 답변 템플릿(`listTemplates`)도 서비스 스코프에서는 부르지 않고 빈 배열.

`app/(admin)/inquiries/[id]/page.tsx`(예전 링크 리다이렉트)는 문의의 `gameId`가 null이면 서비스 스코프로 URL을 만든다. `legacyInquiryRedirectHref(scope, inquiryId, listParam)`.

## 화면

### 게임 레일 (`components/layout/GameRail.tsx`)

P+ 로고와 구분선 아래, 게임 목록 위에 "서비스 문의" 타일을 고정으로 하나 그린다.

- 40×40 둥근 사각형, 게임 로고 자리에는 아이콘(편지 봉투 SVG, `stroke="currentColor"`). `title="서비스 문의 (제휴·기타)"`.
- `pathname.startsWith("/service/")`이면 게임 타일과 같은 활성 링 스타일.
- 접수 건수 배지는 `newCounts["service"]`로 게임 타일과 같은 방식.
- 타일 아래에 구분선을 하나 더 두어 게임 목록과 시각적으로 나눈다.

### 문의함 보기 열 (`components/inbox/InboxNav.tsx`)

`game: GameRow` prop을 `scope: InboxScope`와 `title: string`으로 바꾼다. `InboxShell`이 게임이면 `game.name`, 서비스면 `"서비스 문의"`를 넘긴다.

- 머리글: 서비스 스코프에서는 서비스중/종료 배지를 그리지 않는다. 부제는 그대로 `문의함 · 전체 N건`.
- 보기(접수/처리중/완료/전체/3일 이상 미처리), 검색, 유형, 우선순위는 동일. 유형 목록은 `labels.typeOrder`이므로 서비스 스코프에서는 자동으로 `service_types`가 나온다.
- 바닥의 "답변 템플릿" 링크와 게임 삭제 버튼은 게임 스코프에서만 그린다. `InboxNav`가 `game: GameRow | null`도 함께 받아 이 두 요소에만 쓴다.

### 목록·대화·상세

- `InboxList`, `InboxSearch`, `InboxPrevNext`, `InboxConversation`: `gameId` prop을 `scope`로 바꾸는 것 외에 변화 없음. 목록 행은 게임 계정을 보여주지 않으므로 null이어도 문제없다.
- `ReplyComposer`/`ReplyForm`: 변화 없음. `TemplatePicker`는 고를 템플릿이 없으면 이미 아무것도 그리지 않으므로, 빈 배열을 넘기면 템플릿 선택이 자연스럽게 사라진다.
- `InboxDetailPanel`: `history` prop을 `AccountHistoryEntry[] | null`로 바꾼다. null이면 "계정 이력" 탭 자체를 그리지 않고 상세만 보인다. 접수 정보의 "회사명" 행은 이미 `inquiryMetaRows`가 값이 있을 때 넣는다.
- `InboxEmptyState`: 변화 없음.

### 상세 패널의 `AccountHistoryPanel`

`gameId: string` prop은 그대로. 서비스 스코프에서는 렌더되지 않으므로 null을 받을 일이 없다.

## 알림·답변 라우트

`app/api/notify/inquiry/route.ts`

- `record.game_id`를 `z.string().nullish()`로.
- `game_id`가 null이면 게임명 조회를 건너뛰고 `gameName: "서비스 문의"`, 라벨은 `listServiceCategoryLabels`, `detailUrl`은 `/service/inquiries/{id}`.
- Slack 메시지 형식(`lib/slack.ts`)은 그대로. `[서비스 문의] 새 문의 · 사업 제휴 문의 · 퍼블리싱 제휴 · 제목`처럼 나온다.

`app/api/inquiries/[id]/reply/route.ts`

- 이미 `game_id`가 null이면 게임명 없이 보낸다. 라벨 조회만 `listCategoryLabelsForScope`로 바꿔 서비스 유형 라벨이 메일 템플릿에 들어가게 한다.

`app/api/inquiries/[id]/suggest/route.ts`(답변 추천)

- 라벨은 `listCategoryLabelsForScope`로, 템플릿은 `gameId`가 있을 때만 `listTemplates`를 부르고 없으면 빈 배열, 게임명은 빈 문자열.
- `listRecentRepliesByType(supabase, scope, typeKey)`(`lib/replies.ts`)는 첫 인자를 스코프로 바꿔 서비스 스코프에서는 `is("game_id", null)`로 같은 유형의 과거 답변을 찾는다.

그 밖의 `/api/inquiries/[id]/*` 라우트(status, priority, notes, draft, sync-replies, bulk-status)는 `game_id`를 보지 않으므로 변화 없다.

## 에러 처리

- 서비스 카테고리 조회 실패: 빈 라벨 맵으로 그린다. 유형 필터 목록이 비고 문의의 유형은 키 그대로 보인다. 핵심(목록·답변)은 막지 않는다.
- 건수 RPC 실패: 기존대로 `null`을 돌려주고 건수 없이 그린다.
- 마이그레이션 0009를 아직 적용하지 않은 상태에서 서비스 스코프로 RPC를 부르면 `game_id = null` 비교가 항상 거짓이라 건수가 전부 0으로 나온다. 목록은 RPC와 무관하게 정상이다. 배포 순서: 0009 적용 → 코드 배포.
- 서비스 스코프에서 게임 문의 id를 열면 `notFound()`. 반대도 같다.

## 테스트

- `tests/lib/inbox-scope.test.ts`: `scopeBasePath`, `scopeGameId`.
- `tests/lib/inquiry-filters.test.ts`: 서비스 스코프의 `inquiryListHref`/`inquiryHref`/`inboxHref`/`legacyInquiryRedirectHref`가 `/service/inquiries…`를 만드는지. 게임 스코프의 기존 케이스는 그대로 통과해야 한다.
- `tests/lib/inquiries.test.ts`: `applyFilters`가 서비스 스코프에서 `is("game_id", null)`을 부르는지, `countNewInquiriesByGame`이 null 행을 `"service"` 키로 세는지, `getInquiryFacetCounts`가 서비스 스코프에서 `p_game_id: null`을 넘기는지.
- `tests/lib/categories.test.ts`: `listServiceCategoryLabels`가 그룹·유형 순서를 지키는지, 실패 시 빈 맵인지.
- `tests/lib/replies.test.ts`: `listRecentRepliesByType`이 서비스 스코프에서 `is("game_id", null)`을 쓰는지.
- `tests/api/inquiry-suggest.test.ts`: `game_id` null 문의에서 템플릿 조회 없이 추천이 동작하는지.
- `tests/components/GameRail.test.tsx`(신규): 서비스 타일이 게임 목록 앞에 있고 `/service/inquiries`로 링크되며 `newCounts.service` 배지를 그리는지, `/service/` 경로에서 활성인지.
- `tests/components/InboxNav.test.tsx`: 서비스 스코프에서 제목이 "서비스 문의"이고 상태 배지·템플릿 링크·삭제 버튼이 없는지.
- `tests/components/InboxDetailPanel.test.tsx`: `history`가 null이면 계정 이력 탭이 없는지.
- `tests/api/notify-inquiry.test.ts`: `game_id: null` 페이로드가 400이 아니라 "서비스 문의"로 Slack에 가고 링크가 `/service/inquiries/{id}`인지.
- 스코프 변경으로 시그니처가 바뀌는 기존 테스트는 게임 스코프 객체를 넘기도록 고친다.

## 문서

- `CLAUDE.md` 핵심 기능 2번에 서비스 문의 스코프(`/service/inquiries`)를 한 줄 추가.
- `docs/PRD.md` U1을 완료로 옮기고 0009/0010 마이그레이션을 기록.
- `docs/superpowers/specs/2026-09-01-admin-panel-design.md`의 "2026-09-01 추가" 절 끝에 이 문서로의 링크를 단다.
