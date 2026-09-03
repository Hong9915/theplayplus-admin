# 인박스형 4단 레이아웃 설계

작성일: 2026-09-03
관련 시안: https://claude.ai/code/artifact/47094418-86dd-48ff-baed-088c3f25249c (A안 채택)

## 목표

지금은 게임별 문의 목록 페이지와 문의 상세 페이지가 분리되어 있어, 답변 하나를 쓰려면 목록 → 상세 → 목록을 오가야 한다. 이를 헬프데스크 인박스처럼 **한 화면**으로 합친다.

```
┌──┬──────────┬────────────┬──────────────────────────┬───────────┐
│레│ 문의함   │ 문의 목록  │ 대화 + 답변 작성         │ 상세 패널 │
│일│ 보기     │            │                          │           │
│  │ 상태/유형│ 카드형 행  │ 헤더·타임라인·작성란     │ 처리/정보 │
│  │ 우선순위 │ 일괄 변경  │                          │ 계정 이력 │
└──┴──────────┴────────────┴──────────────────────────┴───────────┘
 64px  224px     340px            flex                  300px
```

한 번에 전환한다. 중간 배포 단계는 두지 않는다.

## 1. 라우트와 URL

### 새 페이지

`app/(admin)/games/[gameId]/inquiries/[[...inquiryId]]/page.tsx` 하나가 4단 화면 전체를 서버 렌더한다.

- `/games/{gameId}/inquiries` — 목록만. 대화·상세 자리에는 빈 상태("목록에서 문의를 선택하세요").
- `/games/{gameId}/inquiries/{inquiryId}` — 목록 + 대화 + 상세.
- `inquiryId` 세그먼트가 두 개 이상이면 `notFound()`.
- 존재하지 않는 문의 id, 또는 다른 게임의 문의 id면 `notFound()`.

Next 14의 `layout.tsx`는 searchParams를 읽을 수 없으므로 목록을 layout에 두지 않는다. 문의를 고를 때마다 목록 쿼리가 다시 실행되지만, 인덱스가 있는 50건 페이지 쿼리라 감수한다.

### 쿼리 파라미터

필터·정렬·검색·페이지는 지금처럼 URL 쿼리가 원본이다. 문의를 골라도 같은 쿼리가 URL에 그대로 남으므로, 지금의 `?list=<인코딩된 쿼리>` 방식과 `inquiryDetailHref`는 폐기한다.

`InquiryListQuery`에 두 항목을 추가한다.

| 키 | 값 | 의미 |
|---|---|---|
| `priority` | `urgent` \| `high` \| `normal` \| `low` | 우선순위 일치 |
| `stale` | `1` | 상태가 `resolved`가 아니면서 `created_at < now() - 72h` |

잘못된 값은 기존 규칙대로 조용히 기본값(null/false)으로 떨어뜨린다. 직렬화 시 기본값은 생략한다.

`lib/inquiry-filters.ts`의 링크 헬퍼는 다음으로 정리한다.

```ts
inquiryListHref(gameId, query)              // /games/{g}/inquiries?...
inquiryHref(gameId, inquiryId, query)       // /games/{g}/inquiries/{id}?...
```

### 레거시 경로

`app/(admin)/inquiries/[id]/page.tsx`는 문의의 `game_id`를 조회해 `redirect('/games/{gameId}/inquiries/{id}')`만 수행한다. `?list=` 쿼리가 붙어 있으면 디코드해 새 URL의 쿼리로 넘긴다. 문의가 없으면 `notFound()`. 이미 발송된 Slack 메시지의 링크 호환용이며, 새 링크는 만들지 않는다.

`app/api/notify/inquiry/route.ts`는 `detailUrl`을 `/games/{record.game_id}/inquiries/{record.id}`로 만든다.

### 관리자 layout

`app/(admin)/layout.tsx`의 `<main>`에서 `px-8 py-6`을 제거하고 `flex-1 min-w-0 h-screen overflow-hidden flex`로 바꾼다. 인박스 페이지는 이 공간을 꽉 채운다. 다른 두 페이지는 스스로 여백을 가진다.

- `games/page.tsx` (게임 없음 안내): 루트를 `flex-1 overflow-y-auto px-8 py-6`로 감싼다.
- `games/[gameId]/templates/page.tsx`: 동일하게 감싼다.

## 2. 화면 구성

새 컴포넌트는 `components/inbox/`에 둔다. 기존 `components/inquiries/`의 재사용 컴포넌트는 그대로 둔다.

### `InboxShell` (server)

페이지가 넘겨주는 데이터를 받아 4단을 배치하는 순수 레이아웃 컴포넌트. 루트는 `flex h-screen min-w-[1180px]`. 게임 레일은 관리자 layout이 이미 그리므로 여기에는 문의함 보기부터 상세 패널까지 4개 열만 있다. `inquiry`가 null이면 대화·상세 자리에 `InboxEmptyState` 하나를 그린다.

### `InboxNav` (server, 검색 입력만 client)

폭 224px, 흰 패널, 오른쪽 경계선.

- 머리: 게임명(굵게) + 서비스중/종료 pill + "문의함 · 전체 N건".
- `InboxSearch` (client): 지금 `InquiryMailbox`의 검색 입력을 옮긴다. 300ms 디바운스 후 `q`를 바꾸고 `page`를 1로 되돌리며 `router.replace`.
- 보기 목록. 각 항목은 `<Link>`이고 href는 현재 쿼리에서 해당 필터만 바꾼 것(`page`는 1로).

  | 항목 | 쿼리 | 건수 표시 |
  |---|---|---|
  | 접수 | `status=new` | accent 배지 (0이면 숨김) |
  | 처리중 | `status=in_progress` | 회색 숫자 |
  | 완료 | `status=resolved` | 회색 숫자 |
  | 전체 | status/priority/stale 제거 | 회색 숫자 |
  | 3일 이상 미처리 | `stale=1` | accent 숫자 (0이면 회색 0) |

  활성 항목은 `bg-ground` + 굵은 글씨. 활성 판정은 URL 쿼리와 항목의 쿼리가 status/stale 기준으로 같은지로 한다.
- "유형" 섹션: 게임의 유형을 그룹 `sort_order` → 유형 `sort_order` 순으로 나열. 지금 `listCategoryLabels`는 라벨 맵만 주고 순서가 없으므로, `CategoryLabelMaps`에 `typeOrder: string[]`(정렬된 유형 key 목록)를 추가하고 두 조회에 `sort_order` 정렬을 건다. href는 `type=<key>` (group은 지우고 type만). 건수는 해당 유형 전체 건수. 활성 = `query.type === key`.
- "우선순위" 섹션: 긴급, 높음 두 항목만. 색점(빨강/주황) + 라벨 + 건수. href는 `priority=<key>`. 활성 = `query.priority === key`.
- 바닥: "답변 템플릿" 링크(`/games/{g}/templates`), 그리고 지금 목록 헤더에 있던 `DeleteGameButton`을 여기로 옮긴다.

### `InboxList` (client)

폭 340px. `InquiryMailbox`를 대체한다. props: `page`, `query`, `labels`, `gameId`, `selectedId`.

- 머리(52px): 전체 선택 체크박스, "{현재 보기 이름} {total}건", 오른쪽에 정렬 셀렉트(최신순/오래된순/우선순위순 → `sort`).
- 행(카드형): 1줄 접수번호(mono) · 경과(mono, 3일 이상이고 미완료면 accent 굵게), 2줄 제목(굵게, 한 줄 말줄임), 3줄 본문 첫 줄(muted, 한 줄 말줄임), 4줄 상태 배지 · 유형 라벨 · 우선순위(긴급 빨강 굵게 / 높음 주황 / 보통·낮음은 표시 안 함).
- 행 왼쪽 2px: 접수(new)면 accent 선, 아니면 투명. 선택된 문의(`selectedId`)는 `bg-accent/5`와 accent 선. 체크된 행은 `bg-accent/5`.
- 행 클릭 → `router.push(inquiryHref(gameId, id, query))`. 체크박스 클릭은 전파를 막는다.
- 체크가 하나 이상이면 바닥에 일괄 변경 바: "N건 선택" + 상태 셀렉트 + "변경" 버튼. 로직은 지금 `applyBulkStatus`를 그대로 옮긴다. 결과 메시지도 이 바에 표시.
- 바닥(44px): "{first}–{last} / {total}건" + 이전/다음. 총 건수가 한 페이지 이하면 이전/다음은 숨기고 건수만 표시.
- 빈 목록: "조건에 맞는 문의가 없습니다."

행 본문 미리보기는 `content`의 첫 줄을 쓰며 길이 제한은 CSS 말줄임에 맡긴다. 첨부 개수 표시는 하지 않는다(추가 조인 필요).

### `InboxConversation` (server)

가운데 열. 흰 배경, 오른쪽 경계선. 세로로 헤더 / 타임라인 / 작성란.

- 헤더(64px, 경계선): 왼쪽에 접수번호(mono) + 제목(굵게, 한 줄 말줄임), 그 아래 상태 배지 · "종류 · 유형" · "접수 {시각} · 경과 {경과}". 오른쪽에 이전/다음(`InboxPrevNext`), 회신 확인(`SyncRepliesButton`, Gmail 스레드가 있을 때만), 완료로 표시(`ResolveButton`).
- `InboxPrevNext`: `listInquiryIds`로 뽑은 id 배열에서 현재 위치를 찾아 `‹ n / N ›`. 링크는 `inquiryHref(gameId, id, query)`. 배열에 현재 id가 없으면(다른 조건으로 들어온 경우) 그리지 않는다. 기존 `InquiryNav`의 "← 목록"은 없어진다 — 목록이 항상 보인다.
- 타임라인 영역: `flex-1 overflow-y-auto`, 배경 `bg-ground`, `InboxTimeline`.
- 작성란: `ReplyComposer`.

### `InboxTimeline` (server)

`buildTimeline()`이 만든 항목 배열을 시간순으로 그린다. 항목 종류별 모양:

| 종류 | 아바타 | 말풍선 |
|---|---|---|
| `inquiry` (문의 본문) | accent 연한 원 + 계정 첫 글자 | 흰 카드, 본문 `whitespace-pre-wrap`, 아래에 첨부 이미지 썸네일(기존 `InquiryDetail`의 첨부 렌더를 옮김) |
| `inbound` (사용자 회신) | 위와 같음 | 흰 카드 |
| `outbound` (보낸 답변) | 검정 원 "P+" | 흰 카드, 오른쪽 정렬 |
| `note` (내부 메모) | 연한 주황 원 + 연필 아이콘 | `bg-amber-50 border-amber-200` 카드, "내부 메모" 라벨 |

각 말풍선 위에 작성자(계정 / `emailLocalPart`) · 종류 라벨 · 시각(mono).

### `ReplyComposer` (client)

작성란. 위에 "답변 / 내부 메모" 탭(로컬 상태, 기본 답변).

- 답변 탭: 기존 `ReplyForm`을 그대로 렌더. 탭 오른쪽에 "받는 사람 {replyEmail}".
- 내부 메모 탭: 기존 `InquiryNotes`의 폼 부분만 옮긴 `NoteForm`(client). 저장 성공 시 `router.refresh()` → 타임라인에 나타난다.

`ReplyForm`은 수정하지 않는다. 답변 발송 후의 상태 변경·목록 갱신은 기존대로 `router.refresh()`가 맡는다.

### `InboxDetailPanel` (client, 탭만)

폭 300px. 상단 탭 "상세 / 계정 이력 (N)". 로컬 상태, 기본 상세. 아래 내용은 스크롤.

- 상세 탭
  - 처리: `StatusSelect`, `PrioritySelect` (기존 컴포넌트).
  - 접수 정보: 기존 `InquiryMetaCard`의 행 계산(고정 4행 + `metaEntries`)을 그대로 쓰되 카드 테두리 없이 섹션으로.
  - 처리 기록: `InquiryEventLog`의 내용을 색점 + 한 줄 + 시각(mono) 형태로. 문구는 기존 `describeEvent`.
- 계정 이력 탭: 기존 `AccountHistoryPanel`을 카드 테두리 없이 렌더. 탭 라벨의 N은 이전 문의 건수.

섹션 제목은 12px 굵은 muted, 섹션 사이 경계선.

### 삭제하는 것

`InquiryMailbox`, `InquiryNav`, `InquiryDetail`, `InquiryThread`, `InquiryNotes`, `InquiryHeader`, `InquiryMetaCard`, `InquiryEventLog`와 각 테스트. 이 중 유지할 로직(첨부 렌더, 메타 행 계산, 이벤트 문구, 일괄 변경, 검색 디바운스)은 새 컴포넌트로 옮긴다.

### 유지하는 것

`GameRail`, `StatusBadge`, `StatusSelect`, `PrioritySelect`, `ResolveButton`, `SyncRepliesButton`, `ReplyForm`, `TemplatePicker`, `SuggestButton`, `AccountHistoryPanel`, `DeleteGameButton`, `TemplateManager`, `GameForm`.

## 3. 타임라인 조립 (`lib/timeline.ts`)

```ts
export type TimelineEntry =
  | { kind: "inquiry"; id: string; at: string; author: string | null; body: string; attachments: AttachmentWithUrl[] }
  | { kind: "outbound"; id: string; at: string; author: string | null; body: string }
  | { kind: "inbound"; id: string; at: string; author: string | null; body: string }
  | { kind: "note"; id: string; at: string; author: string; body: string };

export function buildTimeline(
  inquiry: InquiryRow,
  attachments: AttachmentWithUrl[],
  messages: MessageRow[],
  notes: NoteRow[]
): TimelineEntry[];
```

- 문의 본문은 항상 첫 항목(`at = createdAt`, `author = gameAccount`).
- 메시지는 `direction`에 따라 outbound/inbound, `at = sentAt`, `author = authorEmail`.
- 메모는 `at = createdAt`, `author = authorEmail`.
- 문의 본문을 제외한 나머지를 `at` 오름차순으로 정렬. 같은 시각이면 입력 순서 유지(안정 정렬).

## 4. 집계 쿼리

문의함 보기의 건수는 SQL 함수 한 번으로 가져온다. 행을 전부 읽어 JS에서 세는 방식은 Supabase의 기본 1,000행 응답 제한에 걸리므로 쓰지 않는다.

### 마이그레이션 `supabase/migrations/0008_inquiry_facet_counts.sql`

```sql
create or replace function inquiry_facet_counts(p_game_id uuid)
returns table (facet text, key text, count bigint)
language sql stable as $$
  select 'status', status, count(*) from inquiries where game_id = p_game_id group by status
  union all
  select 'type', type_key, count(*) from inquiries where game_id = p_game_id group by type_key
  union all
  select 'priority', coalesce(priority, 'normal'), count(*) from inquiries where game_id = p_game_id group by 2
  union all
  select 'stale', '1', count(*) from inquiries
    where game_id = p_game_id and status <> 'resolved' and created_at < now() - interval '72 hours'
  union all
  select 'total', 'all', count(*) from inquiries where game_id = p_game_id
$$;
```

권한: 인증된 사용자만 실행(`revoke execute ... from anon`). 관리자 앱은 로그인 세션으로 호출한다.

### `lib/inquiries.ts`

```ts
export interface InquiryFacetCounts {
  total: number;
  status: Record<InquiryStatus, number>;
  type: Record<string, number>;
  priority: Record<InquiryPriority, number>;
  stale: number;
}
export async function getInquiryFacetCounts(supabase, gameId): Promise<InquiryFacetCounts | null>;
```

RPC 실패 시 `null`을 돌려주고, `InboxNav`는 건수 없이 항목만 그린다(핵심 기능은 막지 않는다).

`applyFilters`에 두 조건을 추가한다.

- `query.priority` → `.eq("priority", value)`
- `query.stale` → `.neq("status", "resolved").lt("created_at", <now - 72h ISO>)`

`FilterBuilder` 인터페이스에 `neq`, `lt`를 추가한다. 현재 시각은 테스트를 위해 `queryInquiries`/`listInquiryIds`의 옵션 인자 `now?: Date`로 주입 가능하게 한다.

### 레일 배지

`countNewInquiriesByGame`도 같은 1,000행 제한을 갖고 있지만 이번 범위에 넣지 않는다. 별도 작업으로 남긴다.

## 5. 데이터 흐름

페이지는 다음을 병렬로 가져온다.

- 항상: `listGames`, `listCategoryLabels`(`typeOrder` 포함), `getInquiryFacetCounts`, `queryInquiries`
- `inquiryId`가 있을 때 추가로: `getInquiryById`, `listAttachmentSignedUrls`, `getAccountHistory`, `listNotes`, `listEvents`, `listTemplates`, `listMessages`, `listInquiryIds`

`getInquiryById` 결과의 `gameId`가 URL의 `gameId`와 다르면 `notFound()`.

쓰기 동작(상태·우선순위 변경, 일괄 변경, 답변 발송, 메모 추가, 회신 확인)은 지금과 같이 API 호출 후 `router.refresh()`. 페이지 전체가 다시 렌더되므로 목록의 배지, 보기 건수, 타임라인이 함께 갱신된다. 새 API는 만들지 않는다.

## 6. 화면 크기와 오류

- 4단 최소 폭 1,180px. 그보다 좁으면 관리자 layout 안에서 가로 스크롤. 모바일 대응은 하지 않는다.
- 목록·대화·상세 세 열은 각자 세로 스크롤. 페이지 전체는 스크롤하지 않는다.
- 문의 id 오류 → `notFound()`. 집계 실패 → 건수 없이 렌더. 그 밖의 부가 작업 실패 처리는 각 기존 컴포넌트의 규칙을 따른다.

## 7. 테스트 (Vitest + RTL)

lib

- `inquiry-filters`: `priority`/`stale` 파싱(정상·오류값), 직렬화(기본값 생략), `inquiryHref`가 쿼리를 유지하는지.
- `inquiries`: `applyFilters`가 `priority`와 `stale`(neq + lt, 주입한 now 기준 72h)을 거는지. `getInquiryFacetCounts`의 RPC 행 → 객체 매핑, 실패 시 null.
- `timeline`: 본문이 첫 항목, 나머지 시간순, 종류 매핑, 첨부 전달.
- `categories`: `typeOrder`가 그룹·유형 `sort_order` 순인지.

components

- `InboxNav`: 활성 보기 강조, 건수 표시(0이면 접수 배지 숨김), href가 현재 쿼리를 유지하고 page를 되돌리는지, 집계 null이면 건수 없이 렌더.
- `InboxList`: 행 렌더, `selectedId` 강조, 체크 시 일괄 바 노출과 API 호출, 정렬 변경 시 URL 갱신, 빈 목록 문구.
- `InboxTimeline`: 네 종류 항목 렌더와 첨부 썸네일.
- `ReplyComposer`: 탭 전환, 메모 저장 성공 시 refresh.
- `InboxDetailPanel`: 탭 전환, 계정 이력 탭 건수.
- `InboxPrevNext`: 첫/끝 항목 비활성, id가 없으면 미렌더.

api / page

- `notify-inquiry`: `detailUrl`이 `/games/{gameId}/inquiries/{id}` 형식.
- 레거시 리다이렉트 페이지: `?list=`가 새 URL 쿼리로 옮겨지는지.

## 8. 범위 밖

- 레일 배지의 1,000행 제한 수정
- 목록 행의 첨부 개수 표시
- 키보드 단축키(j/k 이동 등)
- 모바일·태블릿 레이아웃
- 이벤트 참여 이력 연동
