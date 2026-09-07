# theplayplus-admin

THE PLAY+ 고객지원 관리자 페이지. `theplayplus-contact`(문의 접수 폼) 저장소와 **같은 Supabase 프로젝트를 공유**하는 별도 저장소다. 여기서 만든 코드도 나중에 사람이 직접 메인 사이트 저장소로 복사해 붙여넣는 방식으로 통합될 예정이다.

## 핵심 기능

1. **게임 관리** — 게임 추가(이름/상태 필수, 로고 선택, 게임별 문의 카테고리 커스터마이징), 게임 목록에서 선택. 새 게임에는 `lib/categories.ts`의 기본 종류·유형(계정/보안, 게임 이용, 결제/환불의 10개 유형)과 `lib/default-templates.ts`의 유형별 자동 답변 템플릿이 자동 발송 켜진 상태로 복사된다. 템플릿 복사 실패는 경고만 낸다
2. **인박스 화면** — `/games/{gameId}/inquiries[/{inquiryId}]` 한 페이지가 4단(게임 레일 · 문의함 보기 · 문의 목록 · 대화+답변 · 상세 패널)을 서버 렌더한다. 필터(상태/유형/우선순위/3일 이상 미처리)·정렬·검색·페이지는 URL 쿼리로 관리하고 DB에서 처리하며, 문의를 골라도 같은 쿼리가 URL에 남는다. 보기 건수는 `inquiry_facet_counts` RPC(마이그레이션 0008) 한 번으로 가져오고 실패하면 건수 없이 그린다. 체크박스로 여러 건 상태 일괄 변경. 게임 레일에 접수(new) 건수 배지. 우선순위는 접수 시 DB 트리거가 유형의 `inquiry_types.default_priority`로 정한다(결제·환불·복구 `urgent`, 건의 사항 `low`, 나머지 `normal`, 마이그레이션 0009). 관리자가 상세에서 바꾼 값은 유지된다. 예전 `/inquiries/{id}` 링크는 새 URL로 리다이렉트된다. 게임 레일 맨 위의 "서비스 문의" 타일은 게임 없이 접수된 제휴·기타 문의(`game_id is null`)를 같은 화면으로 `/service/inquiries[/{inquiryId}]`에서 보여준다(`lib/inbox-scope.ts`의 스코프로 분기, 데이터 로딩은 `lib/inbox-page.ts`). 유형 필터는 전역 `service_groups`/`service_types`(마이그레이션 0013)에서 오고, 건수 RPC는 0012부터 null 인자를 서비스 문의로 센다. 서비스 문의에는 계정 이력·같은 계정 이어보기·답변 템플릿이 없다.
3. **문의 답변 발송** — 대화 열에서 답변을 작성해 Gmail API로 바로 발송. 발신 계정은 문의 스코프로 갈린다: 게임 문의는 `GMAIL_SENDER`/`GMAIL_REFRESH_TOKEN`(help@theplayplus.com), 서비스 문의는 `GMAIL_SERVICE_SENDER`/`GMAIL_SERVICE_REFRESH_TOKEN`(info@theplayplus.com)이며 서비스용 두 값이 모두 비면 게임용 계정으로 대신 보낸다(`lib/gmail.ts`의 `Mailbox`, 스코프 종류와 같은 값). 메일 푸터 주소도 그 발신 주소를 따른다. OAuth 클라이언트는 공용이고 refresh token은 계정마다 `scripts/get-gmail-refresh-token.js`로 한 번씩 발급한다. 메일은 THE PLAY+ 브랜드 HTML 템플릿(`lib/email-template.ts`, 로고는 `lib/email-logo.ts`에 base64 인라인 첨부)과 텍스트 본문을 함께 담은 multipart로 나간다. 발송 성공 시 상태가 자동으로 `처리중`으로 바뀌고 답변이 `inquiry_messages`에 쌓임 (`완료`는 헤더의 "완료로 표시" 버튼이나 상태 셀렉트로 직접 변경). 후속 답변은 같은 Gmail 스레드로 묶이며(저장된 스레드가 그 계정에 없으면, 즉 발신 계정을 바꾸기 전에 만든 스레드면 Gmail 404를 받고 새 스레드로 다시 보내 새 id를 저장한다), "회신 확인" 버튼으로 사용자 회신을 그 문의를 보낸 계정의 메일함에서 가져와 타임라인에 표시 (`gmail.readonly` 스코프 필요). Cmd/Ctrl+Enter 발송, 초안 자동 저장. 메일 조립·발송·기록은 `lib/send-reply.ts`에 있고 수동/자동 답변이 공유한다
4. **계정 이력 패널** — 상세 패널의 계정 이력 탭에서 같은 게임 내 동일 `game_account`의 과거 문의를 요약(건수/미처리/같은 유형)과 함께 보여주고 각 항목은 상세로 링크 (이벤트 참여 이력은 현재 데이터 소스가 없어 확장 지점만 마련)
5. **대화·이동** — 대화 열은 문의 본문(첨부 포함)·보낸 답변·사용자 회신·내부 메모를 시간순 한 줄기로 보여주고(`lib/timeline.ts`), 같은 게임·같은 `game_account`의 다른 문의도 접수 순으로 구분선을 두고 이어 보여준다(선택한 문의로 자동 스크롤). 작성란은 답변/내부 메모 탭. 헤더의 이전/다음은 목록과 같은 조건·정렬 안에서 움직인다.
6. **새 문의 Slack 알림** — Supabase Database Webhook(`inquiries` INSERT)이 `/api/notify/inquiry`를 호출하면 게임명·유형·제목·상세 링크를 Slack Incoming Webhook으로 보낸다(`lib/slack.ts`). 호출자는 `x-webhook-secret` 헤더가 `INQUIRY_WEBHOOK_SECRET`과 일치해야 하고, `SLACK_WEBHOOK_URL`이 비어 있으면 조용히 건너뛴다. 지금은 모든 신규 문의를 보내며, 특정 유형만 보내려면 이 라우트에서 거르면 된다. 서비스 문의는 게임명 자리에 "서비스 문의"가 들어가고 링크는 `/service/inquiries/{id}`다.

7. **유형별 매크로 자동 답변** — 답변 템플릿(`reply_templates`)에 "자동 발송"을 켜 두면(게임·유형당 하나, 공용 템플릿은 유형 전용이 없을 때의 대체) 새 문의에 그 내용을 브랜드 이메일로 보낸다. 접수 직후가 아니라 **30분~1시간 뒤 랜덤**으로 나간다: 접수 시 DB 트리거가 `inquiries.auto_reply_due_at`을 채우고(그 게임에 자동 발송 템플릿이 있을 때만), Supabase `pg_cron`이 매분 `/api/auto-reply/run`을 호출하면 `claim_due_auto_replies` RPC로 예정 시각이 지난 건을 가져와 보낸다(마이그레이션 0014). RPC가 예정을 지우면서 행을 돌려주므로 호출이 겹쳐도 두 번 보내지 않고, 기다리는 사이 관리자가 먼저 답했거나 템플릿이 꺼졌으면 건너뛰며, 발송 실패는 5분 뒤로 다시 예약한다. 상태는 `접수`로 남기고 마지막 답변도 갱신하지 않으며, 타임라인에는 "자동 발송"으로, 이력에는 "자동 답변 발송"으로 구분해 보인다. 인증은 Slack 알림과 같은 `x-webhook-secret`(`lib/webhook-secret.ts`)

8. **대화 번역** — 대화 열의 말풍선(문의 본문·이메일 회신·보낸 답변, 내부 메모 제외)을 우클릭하면 "한국어로 번역" / "중국어(간체)로 번역" 메뉴가 뜨고, 번역문이 원문 아래에 이어 붙는다(`components/inbox/TranslatableBody.tsx`). `POST /api/inquiries/{id}/translate`가 DB의 원문을 읽어 DeepL(`lib/deepl.ts`, `DEEPL_API_KEY`, `:fx` 키면 무료 엔드포인트)로 번역하고 `inquiries.translations` / `inquiry_messages.translations` jsonb(`{"ko":…, "zh":…}`, 마이그레이션 0015)에 언어별로 저장해 다시 열어도 남는다(`lib/translations.ts`). 원문이 이미 그 언어면 저장하지 않고 안내만 한다. 저장된 언어는 메뉴가 숨기기/다시 번역으로 바뀐다.

9. **사용자 회신 자동 동기화** — 관리자가 "회신 확인"을 누르지 않아도 Supabase `pg_cron` 잡 `reply-sync-run`이 5분마다 `/api/replies/sync`를 부르고(마이그레이션 0017, 인증은 자동 답변과 같은 `x-webhook-secret`), 발신 메일함(help@, info@)마다 "마지막 확인 이후 받은 메일"을 `messages.list`로 한 번에 가져와 스레드 id로 문의에 맞춰 `inquiry_messages`에 inbound로 넣는다(`lib/reply-sync.ts`, `lib/gmail.ts`의 `listInboundSince`). 마지막 확인 시각은 `gmail_sync_state`에 메일함별로 저장하고 10분 앞에서 다시 훑으며(중복은 `gmail_message_id` 유니크 인덱스가 거름), 첫 실행은 24시간 전부터 본다. 서비스 계정이 게임 계정으로 대체되면 한 번만 읽는다. 새 회신이 들어온 문의는 `inquiries.unread_reply_at`이 채워져 목록에 "회신 옴" 배지, 문의함 보기에 "회신 도착"(URL `unread=1`, 건수는 RPC의 `unread` 항목)으로 보이고, 관리자가 그 문의를 열면(`MarkReadOnOpen` → `/api/inquiries/{id}/mark-read`) 또는 수동 답변을 보내면 비워진다. 상태는 바꾸지 않고 Slack 알림도 없다(붙이려면 sync 라우트에서 `added`를 보면 된다). Gmail 조회 실패는 확인 시각을 갱신하지 않아 다음 실행이 다시 본다. "회신 확인" 버튼은 즉시 확인용으로 그대로 있다.

상세 설계는 `docs/superpowers/specs/2026-09-01-admin-panel-design.md`, 인박스 화면은 `docs/superpowers/specs/2026-09-03-inbox-layout-design.md`, 자동 답변은 `docs/superpowers/specs/2026-09-03-auto-reply-design.md`, 회신 동기화는 `docs/superpowers/specs/2026-09-07-reply-sync-design.md` 참고.

## 기술 스택

- Next.js 14 (App Router, TypeScript) + Tailwind CSS
- Supabase (Postgres + Auth + Storage) — `theplayplus-contact`와 동일 프로젝트 공유
- Supabase Auth (이메일+비밀번호, 여러 관리자 계정 가능, 역할 구분 없음)
- Gmail API (`googleapis`) — 답변 이메일 발송
- Vitest + React Testing Library

## Slack 알림 설정 절차

1. Slack 워크스페이스에서 앱 생성 → Incoming Webhooks 활성화 → 알림 받을 채널을 골라 Webhook URL 발급
2. 관리자 앱 환경변수에 `SLACK_WEBHOOK_URL`(발급한 URL)과 `INQUIRY_WEBHOOK_SECRET`(임의의 긴 문자열) 설정 후 재배포
3. Supabase 대시보드 → Database → Webhooks → Create: 테이블 `inquiries`, 이벤트 `Insert`, 타입 HTTP Request(POST), URL `https://<관리자 도메인>/api/notify/inquiry`, HTTP Headers에 `x-webhook-secret: <2번의 비밀값>` 추가
4. 접수 폼에서 테스트 문의를 넣어 Slack 채널에 메시지가 오는지 확인 (로컬 개발 서버는 외부에서 못 부르므로 배포 환경에서 확인)

## 자동 답변 설정 절차

1. Supabase SQL Editor에서 Vault에 비밀값을 넣는다 (한 번만): `select vault.create_secret('<INQUIRY_WEBHOOK_SECRET 값>', 'inquiry_webhook_secret');`
2. 마이그레이션 `0014_auto_reply_schedule.sql`을 실행한다. 컬럼·트리거·RPC를 만들고 `pg_cron` 잡 `auto-reply-run`이 매분 `https://admin.theplayplus.com/api/auto-reply/run`을 호출하게 등록한다. 도메인이 다르면 파일 안의 url을 바꿔 실행한다
3. 예전 방식의 Supabase 웹훅(`inquiries` INSERT → `/api/auto-reply/inquiry`)이 등록돼 있으면 지운다. 그 라우트는 없어졌다
4. 관리자 앱의 게임별 "답변 템플릿" 화면에서 유형별 템플릿을 만들고 "자동 발송 켜기"를 누른다. 같은 유형에 다른 템플릿을 켜면 이전 것은 자동으로 꺼진다
5. 접수 폼에서 테스트 문의를 넣고 30분~1시간 뒤 메일이 오는지, 문의함 타임라인에 "자동 발송"으로 보이는지 확인. 실행 기록은 `select * from cron.job_run_details order by start_time desc limit 20;`

## 회신 자동 동기화 설정 절차

1. 두 발신 계정(help@, info@)의 refresh token에 `gmail.readonly` 스코프가 있는지 확인한다. 없으면 `scripts/get-gmail-refresh-token.js`로 다시 발급해 환경변수를 바꾼다
2. 마이그레이션 `0017_reply_sync.sql`을 실행한다. 컬럼·표·건수 RPC를 만들고 `pg_cron` 잡 `reply-sync-run`이 5분마다 `https://admin.theplayplus.com/api/replies/sync`를 호출하게 등록한다. Vault의 `inquiry_webhook_secret`은 자동 답변 설정 때 넣은 것을 그대로 쓴다
3. 테스트 문의에 답변을 보내고 그 메일에 회신한 뒤 5분 안에 목록에 "회신 옴"이 뜨는지 확인. 실행 기록은 `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'reply-sync-run') order by start_time desc limit 20;`

## 컨벤션

- 관리자 UI는 한국어 전용 (다국어 없음)
- 카테고리/그룹/유형은 하드코딩하지 않고 DB(`inquiry_groups`, `inquiry_types`)에서 게임별로 관리
- 실패해도 되는 부가 작업(로고 업로드, 이메일 발송)이 실패해도 핵심 데이터(게임/문의) 저장은 막지 않는다 — 경고만 표시하고 재시도 가능하게 함
- Supabase 자격 증명, Gmail OAuth 관련 값은 절대 코드/문서에 평문으로 커밋하지 않는다 — `.env`로만 관리
