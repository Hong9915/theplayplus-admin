# 유형별 매크로 자동 답변 설계

새 문의가 들어오면 그 유형에 등록된 "자동 발송" 템플릿을 브랜드 이메일로 보낸다. 2026-09-04부터는 접수 직후가 아니라 뒤늦게 랜덤으로 나간다 (아래 "지연 발송" 절). 처음엔 30분~1시간이었고 2026-09-07(마이그레이션 0016)부터 5분~30분이다.
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

## 지연 발송 (마이그레이션 0014, 2026-09-04)

접수 직후 자동 답변이 나가면 기계가 보낸 티가 난다. 대신 5분~30분 뒤 랜덤으로 보낸다(0014에서는 30분~1시간이었고 0016에서 줄였다). 서버리스 함수는 몇 분씩 기다릴 수 없으므로 "예정 시각을 DB에 적고 매분 도는 작업이 때가 된 것만 보내는" 구조다.

| 구성 | 내용 |
|---|---|
| `inquiries.auto_reply_due_at timestamptz` | 자동 답변 예정 시각. 보내면 null |
| 트리거 `inquiries_assign_auto_reply_due` (before insert) | 게임에 자동 발송 템플릿이 하나라도 있으면 `now() + 5분 + random()*25분` (0016 이전에는 `30분 + random()*30분`). insert에 값을 명시하면 그대로 둔다 |
| RPC `claim_due_auto_replies(p_limit)` | `due_at <= now()`인 행을 `for update skip locked`로 잡아 `due_at`을 null로 바꾸며 돌려준다. 한 문장이라 호출이 겹쳐도 같은 건을 두 번 주지 않는다. 돌려주는 컬럼은 `REPLYABLE_INQUIRY_COLUMNS`와 같다. service_role만 실행 가능 |
| `pg_cron` 잡 `auto-reply-run` (`* * * * *`) | `pg_net`으로 `POST https://admin.theplayplus.com/api/auto-reply/run`. `x-webhook-secret`은 Vault의 `inquiry_webhook_secret`에서 읽는다 |

### `POST /api/auto-reply/run`

- 인증: `x-webhook-secret` (`lib/webhook-secret.ts`). 본문은 무시한다.
- 흐름:
  1. `claim_due_auto_replies(10)`. 실패하면 502 `claim_failed`.
  2. 각 문의에 대해: `game_id` 없음 → 건너뜀. 이미 outbound 메시지 있음(기다리는 사이 관리자가 답함) → 건너뜀. `findAutoReplyTemplate`가 null(그 사이 템플릿이 꺼짐) → 건너뜀.
  3. `sendInquiryReply(mode: "auto")`. 실패하면 `auto_reply_due_at = now() + 5분`으로 되돌려 다음 호출이 재시도하고, 나머지 건은 계속 처리한다.
- 응답: `{ success: true, claimed, sent, skipped, failed }`.
- 한 번에 최대 10건. 매분 돌므로 밀린 건은 다음 분에 이어서 나간다.

이전의 `POST /api/auto-reply/inquiry` (INSERT 웹훅 → 즉시 발송)는 제거했다. 대시보드에 등록된 그 웹훅도 지워야 한다.

## 템플릿 관리

- `lib/templates.ts`: `TemplateRow.autoSend`, `findAutoReplyTemplate`, `setTemplateAutoSend(id, on)`. 켤 때는 같은 게임·유형의 다른 자동 발송을 먼저 끈다 (유니크 인덱스에 걸려 실패하는 것보다 관리자가 기대하는 동작).
- `PATCH /api/templates/[id]` `{ autoSend: boolean }` 추가.
- `TemplateManager`: 목록 각 항목에 "자동 발송" 배지와 켜기/끄기 버튼. 추가 폼에는 넣지 않는다 (만든 뒤 켜면 된다).

## 화면 표시

- `lib/timeline.ts`: outbound 항목에 `auto: boolean`.
- `InboxTimeline`: `auto`면 라벨 "자동 발송", 작성자 "THE PLAY+ 자동 답변".
- `lib/events.ts`: `auto_reply_sent` → "자동 답변 발송".

## 운영 설정

웹훅 대신 pg_cron이다. 절차는 CLAUDE.md "자동 답변 설정 절차" 참고 (Vault 비밀값 → 0014 실행 → 옛 웹훅 삭제). Gmail 환경변수는 이미 답변 발송에 쓰는 것을 그대로 쓴다.

## 범위 밖

- 템플릿 본문 치환 변수(`{{접수번호}}` 등). 브랜드 메일 템플릿이 접수번호·유형·제목·원문을 이미 넣어 주므로 지금은 필요 없다.
- 알림 라우트와 자동 답변 라우트 통합. 다른 세션 작업이 합쳐진 뒤 한다.

## 테스트

- 마이그레이션: 로컬 Postgres에서 유니크 인덱스(같은 유형 두 개 거부, 공용 null 처리)와 컬럼 기본값 확인 (일회성 스크립트).
- `lib/send-reply`: manual/auto 갱신 필드 차이, 발송 실패 throw, 기록 실패 시 `recorded: false`.
- `api/auto-reply/run`: 비밀값 없음 401, claim 실패 502, 예정 없음, 정상 발송, 게임 없음/이미 답변/템플릿 없음은 `skipped`, 발송 실패는 5분 뒤 재예약 후 나머지 계속.
- `lib/templates`: `findAutoReplyTemplate` 우선순위, `setTemplateAutoSend`가 같은 유형 다른 템플릿을 끄는지.
- `lib/timeline`, `InboxTimeline`, `lib/events`, `TemplateManager`: 표시와 토글.
- 기존 `api/inquiry-reply` 테스트가 그대로 통과해야 한다 (리팩터링 회귀 방지).
