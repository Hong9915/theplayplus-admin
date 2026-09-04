# 유형별 매크로 자동 답변 설계

새 문의가 들어오면 그 유형에 등록된 "자동 발송" 템플릿을 브랜드 이메일로 바로 보낸다.
수동 답변과 같은 발송·기록 경로를 쓰되, 상태는 `접수`로 남기고 타임라인에 "자동 발송"으로 구분해 보여준다.

## 결정 사항

- 자동 답변 뒤에도 상태는 `접수(new)` 유지. 접수 확인 성격이라 미처리 목록에서 사라지면 안 된다.
- 타임라인과 이력 탭에 "자동 발송"으로 표시한다. 관리자가 이미 답한 것으로 착각하지 않게 한다.
- 지금 다른 세션이 편집 중인 `app/api/notify/inquiry/route.ts`는 건드리지 않는다. 자동 답변은 **별도 웹훅 라우트**로 받는다.

## 데이터 (마이그레이션 0010)

| 테이블 | 변경 | 이유 |
|---|---|---|
| `reply_templates` | `auto_send boolean not null default false` | 유형별 자동 발송 템플릿 표시 |
| `reply_templates` | 부분 유니크 인덱스 `(game_id, coalesce(type_key, '')) where auto_send` | 같은 게임·유형에 자동 발송 템플릿은 하나만 |
| `inquiry_messages` | `auto_sent boolean not null default false` | 타임라인 "자동 발송" 구분 |

`type_key`가 null인 공용 템플릿도 자동 발송으로 켤 수 있다. 유형 전용 템플릿이 없을 때의 대체다.

## 발송 경로 공용화

`app/api/inquiries/[id]/reply/route.ts`의 "제목 만들기 → 스레드 참조 조회 → 게임명·라벨 조회 → 메일 조립 → Gmail 발송 → inquiries 갱신 → inquiry_messages 기록 → 이벤트 기록"을 `lib/send-reply.ts`의 `sendInquiryReply`로 뽑는다. 수동/자동 차이는 옵션 하나다.

```ts
sendInquiryReply(supabase, {
  inquiry,               // reply 라우트가 select하는 것과 같은 행
  body,                  // 답변 본문
  mode: "manual" | "auto",
  actor,                 // manual: 관리자 세션, auto: AUTO_REPLY_ACTOR
}) => { sent: SentEmail; recorded: boolean }   // 발송 실패는 throw
```

| 항목 | manual | auto |
|---|---|---|
| `status` | `in_progress` | 변경 없음 |
| `reply_content` / `replied_at` / `draft_reply` | 갱신 / 갱신 / 비움 | 변경 없음 |
| `gmail_thread_id` | 갱신 | 갱신 (후속 수동 답변이 같은 스레드에 붙게) |
| `inquiry_messages.auto_sent` | false | true |
| `inquiry_messages.author_email` | 관리자 이메일 | null |
| 이벤트 kind | `reply_sent` | `auto_reply_sent` (actor `auto-reply@theplayplus.com`) |

수동 라우트의 응답과 오류 코드는 그대로 유지한다 (`send_failed` 500, `save_failed` 500, `message_save_failed` 경고).

## 자동 발송 웹훅 `POST /api/auto-reply/inquiry`

- 인증: `x-webhook-secret` 헤더가 `INQUIRY_WEBHOOK_SECRET`과 같아야 한다. Slack 알림 라우트와 같은 비밀값을 쓴다. 검사 함수는 `lib/webhook-secret.ts`로 두고 새 라우트만 쓴다 (알림 라우트는 다른 세션 작업이 끝난 뒤 옮긴다).
- 페이로드: Supabase Database Webhook의 `{ type: "INSERT", table: "inquiries", record: { id } }`. 나머지 필드는 DB에서 다시 읽는다. 웹훅 페이로드 스키마에 의존하지 않기 위해서다.
- 흐름:
  1. 문의를 id로 조회. 없으면 404.
  2. `game_id`가 없으면(사업 문의 등) `{ success: true, sent: false, reason: "no_game" }`.
  3. 이미 보낸 메시지가 있으면(`inquiry_messages`에 outbound 존재) `{ success: true, sent: false, reason: "already_replied" }`. 웹훅 재시도에 대한 멱등 처리.
  4. `findAutoReplyTemplate(supabase, gameId, typeKey)`: 유형 전용 → 공용 순. 없으면 `{ success: true, sent: false, reason: "no_template" }`.
  5. `sendInquiryReply(mode: "auto")`. 발송 실패는 502 `send_failed` (Supabase가 재시도할 수 있게 실패로 응답).
  6. `{ success: true, sent: true }`.
- 접수 데이터는 이미 저장된 뒤라 여기서 실패해도 문의에는 영향이 없다.

## 템플릿 관리

- `lib/templates.ts`: `TemplateRow.autoSend`, `findAutoReplyTemplate`, `setTemplateAutoSend(id, on)`. 켤 때는 같은 게임·유형의 다른 자동 발송을 먼저 끈다 (유니크 인덱스에 걸려 실패하는 것보다 관리자가 기대하는 동작).
- `PATCH /api/templates/[id]` `{ autoSend: boolean }` 추가.
- `TemplateManager`: 목록 각 항목에 "자동 발송" 배지와 켜기/끄기 버튼. 추가 폼에는 넣지 않는다 (만든 뒤 켜면 된다).

## 화면 표시

- `lib/timeline.ts`: outbound 항목에 `auto: boolean`.
- `InboxTimeline`: `auto`면 라벨 "자동 발송", 작성자 "THE PLAY+ 자동 답변".
- `lib/events.ts`: `auto_reply_sent` → "자동 답변 발송".

## 운영 설정

Supabase 대시보드 → Database → Webhooks에 웹훅을 하나 더 만든다. 테이블 `inquiries`, 이벤트 `Insert`, URL `https://<관리자 도메인>/api/auto-reply/inquiry`, 헤더 `x-webhook-secret`은 알림 웹훅과 같은 값. Gmail 환경변수는 이미 답변 발송에 쓰는 것을 그대로 쓴다.

## 범위 밖

- 템플릿 본문 치환 변수(`{{접수번호}}` 등). 브랜드 메일 템플릿이 접수번호·유형·제목·원문을 이미 넣어 주므로 지금은 필요 없다.
- 알림 라우트와 자동 답변 라우트 통합. 다른 세션 작업이 합쳐진 뒤 한다.

## 테스트

- 마이그레이션: 로컬 Postgres에서 유니크 인덱스(같은 유형 두 개 거부, 공용 null 처리)와 컬럼 기본값 확인 (일회성 스크립트).
- `lib/send-reply`: manual/auto 갱신 필드 차이, 발송 실패 throw, 기록 실패 시 `recorded: false`.
- `api/auto-reply`: 비밀값 없음 401, 페이로드 오류 400, 문의 없음 404, 게임 없음/이미 답변/템플릿 없음은 `sent: false`, 정상 발송, 발송 실패 502.
- `lib/templates`: `findAutoReplyTemplate` 우선순위, `setTemplateAutoSend`가 같은 유형 다른 템플릿을 끄는지.
- `lib/timeline`, `InboxTimeline`, `lib/events`, `TemplateManager`: 표시와 토글.
- 기존 `api/inquiry-reply` 테스트가 그대로 통과해야 한다 (리팩터링 회귀 방지).
