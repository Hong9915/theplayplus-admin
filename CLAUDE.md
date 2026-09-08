# theplayplus-admin

THE PLAY+ 고객지원 관리자 페이지. `theplayplus-contact`(문의 접수 폼) 저장소와 **같은 Supabase 프로젝트를 공유**하는 별도 저장소다. 여기서 만든 코드도 나중에 사람이 직접 메인 사이트 저장소로 복사해 붙여넣는 방식으로 통합될 예정이다.

## 핵심 기능

1. **게임 관리** — 게임 추가(이름/상태 필수, 로고 선택, 게임별 문의 카테고리 커스터마이징), 게임 목록에서 선택. 새 게임에는 `lib/categories.ts`의 기본 종류·유형(계정/보안, 게임 이용, 결제/환불의 10개 유형)과 `lib/default-templates.ts`의 유형별 자동 답변 템플릿이 자동 발송 켜진 상태로 복사된다. 템플릿 복사 실패는 경고만 낸다
2. **인박스 화면** — `/games/{gameId}/inquiries[/{inquiryId}]` 한 페이지가 4단(게임 레일 · 문의함 보기 · 문의 목록 · 대화+답변 · 상세 패널)을 서버 렌더한다. 필터(상태/유형/우선순위/3일 이상 미처리)·정렬·검색·페이지는 URL 쿼리로 관리하고 DB에서 처리하며, 문의를 골라도 같은 쿼리가 URL에 남는다. 보기 건수는 `inquiry_facet_counts` RPC(마이그레이션 0008) 한 번으로 가져오고 실패하면 건수 없이 그린다. 체크박스로 여러 건 상태 일괄 변경. 게임 레일에 접수(new) 건수 배지. 우선순위는 접수 시 DB 트리거가 유형의 `inquiry_types.default_priority`로 정한다(결제·환불·복구 `urgent`, 건의 사항 `low`, 나머지 `normal`, 마이그레이션 0009). 관리자가 상세에서 바꾼 값은 유지된다. 예전 `/inquiries/{id}` 링크는 새 URL로 리다이렉트된다. 게임 레일 맨 위의 "서비스 문의" 타일은 게임 없이 접수된 제휴·기타 문의(`game_id is null`)를 같은 화면으로 `/service/inquiries[/{inquiryId}]`에서 보여준다(`lib/inbox-scope.ts`의 스코프로 분기, 데이터 로딩은 `lib/inbox-page.ts`). 유형 필터는 전역 `service_groups`/`service_types`(마이그레이션 0013)에서 오고, 건수 RPC는 0012부터 null 인자를 서비스 문의로 센다. 서비스 문의에는 계정 이력·같은 계정 이어보기·답변 템플릿이 없다.
3. **문의 답변 발송** — 대화 열에서 답변을 작성해 Gmail API로 바로 발송. 발신 계정은 문의 스코프로 갈린다: 게임 문의는 `GMAIL_SENDER`/`GMAIL_REFRESH_TOKEN`(help@theplayplus.com), 서비스 문의는 `GMAIL_SERVICE_SENDER`/`GMAIL_SERVICE_REFRESH_TOKEN`(info@theplayplus.com)이며 서비스용 두 값이 모두 비면 게임용 계정으로 대신 보낸다(`lib/gmail.ts`의 `Mailbox`, 스코프 종류와 같은 값). 메일 푸터 주소도 그 발신 주소를 따른다. OAuth 클라이언트는 공용이고 refresh token은 계정마다 `scripts/get-gmail-refresh-token.js`로 한 번씩 발급한다. 메일은 THE PLAY+ 브랜드 HTML 템플릿(`lib/email-template.ts`, 로고는 `lib/email-logo.ts`에 base64 인라인 첨부)과 텍스트 본문을 함께 담은 multipart로 나간다. 발송 성공 시 상태가 자동으로 `처리중`으로 바뀌고 답변이 `inquiry_messages`에 쌓임 (`완료`는 헤더의 "완료로 표시" 버튼이나 상태 셀렉트로 직접 변경). 후속 답변은 같은 Gmail 스레드로 묶이며, "회신 확인" 버튼으로 사용자 회신을 그 문의를 보낸 계정의 메일함에서 가져와 타임라인에 표시 (`gmail.readonly` 스코프 필요). Cmd/Ctrl+Enter 발송, 초안 자동 저장. 메일 조립·발송·기록은 `lib/send-reply.ts`에 있고 수동/자동 답변이 공유한다
4. **계정 이력 패널** — 상세 패널의 계정 이력 탭에서 같은 게임 내 동일 `game_account`의 과거 문의를 요약(건수/미처리/같은 유형)과 함께 보여주고 각 항목은 상세로 링크 (이벤트 참여 이력은 현재 데이터 소스가 없어 확장 지점만 마련)
5. **대화·이동** — 대화 열은 문의 본문(첨부 포함)·보낸 답변·사용자 회신·내부 메모를 시간순 한 줄기로 보여주고(`lib/timeline.ts`), 같은 게임·같은 `game_account`의 다른 문의도 접수 순으로 구분선을 두고 이어 보여준다(선택한 문의로 자동 스크롤). 작성란은 답변/내부 메모 탭. 헤더의 이전/다음은 목록과 같은 조건·정렬 안에서 움직인다.
6. **새 문의 Slack 알림** — Supabase Database Webhook(`inquiries` INSERT)이 `/api/notify/inquiry`를 호출하면 게임명·유형·제목·상세 링크를 Slack Incoming Webhook으로 보낸다(`lib/slack.ts`). 호출자는 `x-webhook-secret` 헤더가 `INQUIRY_WEBHOOK_SECRET`과 일치해야 하고, `SLACK_WEBHOOK_URL`이 비어 있으면 조용히 건너뛴다. 지금은 모든 신규 문의를 보내며, 특정 유형만 보내려면 이 라우트에서 거르면 된다. 서비스 문의는 게임명 자리에 "서비스 문의"가 들어가고 링크는 `/service/inquiries/{id}`다.

7. **유형별 매크로 자동 답변** — 답변 템플릿(`reply_templates`)에 "자동 발송"을 켜 두면(게임·유형당 하나, 공용 템플릿은 유형 전용이 없을 때의 대체) 새 문의에 그 내용을 브랜드 이메일로 보낸다. 접수 직후가 아니라 **5분~30분 뒤 랜덤**으로 나간다: 접수 시 DB 트리거가 `inquiries.auto_reply_due_at`을 채우고(그 게임에 자동 발송 템플릿이 있을 때만), Supabase `pg_cron`이 매분 `/api/auto-reply/run`을 호출하면 `claim_due_auto_replies` RPC로 예정 시각이 지난 건을 가져와 보낸다(마이그레이션 0014, 지연 범위는 0016). RPC가 예정을 지우면서 행을 돌려주므로 호출이 겹쳐도 두 번 보내지 않고, 기다리는 사이 관리자가 먼저 답했거나 템플릿이 꺼졌으면 건너뛰며, 발송 실패는 5분 뒤로 다시 예약한다. 상태는 `접수`로 남기고 마지막 답변도 갱신하지 않으며, 타임라인에는 "자동 발송"으로, 이력에는 "자동 답변 발송"으로 구분해 보인다. 인증은 Slack 알림과 같은 `x-webhook-secret`(`lib/webhook-secret.ts`)
8. **대화 번역** — 대화 열의 말풍선(문의 본문·이메일 회신·보낸 답변, 내부 메모 제외)을 우클릭하면 "한국어로 번역" / "중국어(간체)로 번역" 메뉴가 뜨고, 번역문이 원문 아래에 이어 붙는다(`components/inbox/TranslatableBody.tsx`). `POST /api/inquiries/{id}/translate`가 DB의 원문을 읽어 DeepL(`lib/deepl.ts`, `DEEPL_API_KEY`, `:fx` 키면 무료 엔드포인트)로 번역하고 `inquiries.translations` / `inquiry_messages.translations` jsonb(`{"ko":…, "zh":…}`, 마이그레이션 0015)에 언어별로 저장해 다시 열어도 남는다(`lib/translations.ts`). 원문이 이미 그 언어면 저장하지 않고 안내만 한다. 저장된 언어는 메뉴가 숨기기/다시 번역으로 바뀐다.

9. **사용자 회신 자동 동기화** — 관리자가 "회신 확인"을 누르지 않아도 Supabase `pg_cron` 잡 `reply-sync-run`이 5분마다 `/api/replies/sync`를 부르고(마이그레이션 0017, 인증은 자동 답변과 같은 `x-webhook-secret`), 발신 메일함(help@, info@)마다 "마지막 확인 이후 받은 메일"을 `messages.list`로 한 번에 가져와 스레드 id로 문의에 맞춰 `inquiry_messages`에 inbound로 넣는다(`lib/reply-sync.ts`, `lib/gmail.ts`의 `openMailbox`). 마지막 확인 시각은 `gmail_sync_state`에 메일함별로 저장하고 10분 앞에서 다시 훑으며(중복은 `gmail_message_id` 유니크 인덱스가 거름), 첫 실행은 24시간 전부터 본다. 서비스 계정이 게임 계정으로 대체되면 한 번만 읽는다. 새 회신이 들어온 문의는 `inquiries.unread_reply_at`이 채워져 목록에 "회신 옴" 배지, 문의함 보기에 "회신 도착"(URL `unread=1`, 건수는 RPC의 `unread` 항목)으로 보이고, 관리자가 그 문의를 열면(`MarkReadOnOpen` → `/api/inquiries/{id}/mark-read`) 또는 수동 답변을 보내면 비워진다. 상태는 바꾸지 않고 Slack 알림도 없다(붙이려면 sync 라우트에서 `added`를 보면 된다). Gmail 조회 실패는 확인 시각을 갱신하지 않아 다음 실행이 다시 본다. "회신 확인" 버튼은 즉시 확인용으로 그대로 있다.

10. **운영 시트 어시스턴트** — 문의함 보기 열의 "운영 어시스턴트 ↗"가 새 탭으로 `/games/{gameId}/assistant`를 연다(`app/(assistant)/`, 레일 없음). 게임에 연결한 구글 스프레드시트·구글 문서(`assistant_sources`, 사이드바의 "+ 자료 추가"에 URL 입력, 여러 개 가능, 마이그레이션 0020)를 서비스 계정(`GOOGLE_SERVICE_ACCOUNT_JSON`, 각 자료를 그 계정에 편집자로 공유)으로 매번 통째로 읽어 `# 시트: 제목`/`# 문서: 제목` 구간의 텍스트로 만들고 OpenAI(`OPENAI_API_KEY`, `OPENAI_MODEL` 기본 `gpt-5-mini`)에 시스템 프롬프트로 싣는다(`lib/assistant-sources.ts`, `lib/sheets.ts`, `lib/docs.ts`, `lib/assistant.ts`). 임베딩 검색은 쓰지 않고 자료 합계 30만 자까지다. 자료 제목은 등록 시 구글에서 읽어 저장하며, 공유가 안 돼 있으면 등록이 거절된다. "52009 VIP4로 올려줘" 같은 수정 요청은 모델이 `propose_update`/`propose_append` 도구(`spreadsheet` 인자로 시트 제목 지정)로 제안만 만들고, 서버가 자료·탭·열·행을 검증해 `sourceId`를 붙여 `assistant_messages`에 `pending`으로 저장하며, 관리자가 카드의 [적용]을 눌러야 그 시트를 다시 읽어 충돌을 확인한 뒤 Sheets API로 쓴다(마이그레이션 0018). 문서는 읽기 전용이고, 시트는 첫 줄이 열 이름인 탭만 수정할 수 있다. 대화는 게임별로 저장되고 ChatGPT식 사이드바에서 고른다(`?c=`). 입력창의 📎로 파일(txt/md/csv/tsv/json/xlsx, 파일당 4MB·메시지당 합계 4MB(Vercel 요청 본문 상한 4.5MB 아래)·5개·대화당 텍스트 200,000자)을 메시지에 붙일 수 있다: 서버가 텍스트만 뽑아 `assistant_messages.attachments` jsonb에 남기고(원본 미보관, 마이그레이션 0019, `lib/attachments.ts`; xlsx는 시트와 같은 표 형식으로 변환, utf-8이 아니면 EUC-KR로 해석) 그 대화의 모든 첨부를 프롬프트의 `# 첨부 파일` 섹션으로 싣는다. 파일은 읽기만 하고 수정 제안은 시트에만 한다. 설계는 `docs/superpowers/specs/2026-09-04-sheet-assistant-design.md`와 `docs/superpowers/specs/2026-09-07-assistant-sources-design.md`.
11. **AI 답변 추천** — 대화 열의 "AI 답변 추천"이 `POST /api/inquiries/{id}/suggest`로 답변 초안을 스트리밍한다(NDJSON, `lib/suggest.ts`). 모델은 어시스턴트와 같은 OpenAI(`OPENAI_API_KEY`, `OPENAI_MODEL` 기본 `gpt-5-mini`, `reasoning_effort: minimal`). 근거 다섯 가지를 프롬프트에 넣는다: (0) **작성 중인 초안** — 작성란에 적혀 있는 글을 버튼이 요청 본문 `draft`로 보내고(최대 5,000자) 규칙에서 "관리자가 원하는 답변이니 내용·결정을 유지해 다듬고 완성하라"로 최우선에 둔다(추천 [적용]은 초안이 있어도 확인 없이 바로 덮어쓴다, 템플릿 선택만 확인을 거친다), (0-1) **이 문의의 대화 이력** — `inquiry_messages`(보낸 답변·자동 답변·사용자 회신)와 내부 메모를 시간순으로 `[보낸 답변 · 2026-09-02 10:00]` 식 머리말과 함께 싣고(항목당 2,000자, 최근 20건) 후속 답변으로 이어 쓰게 한다(내부 메모는 사실 확인용, 문장을 옮기지 않게 규칙), (1) 유형 템플릿, (2) **유사 과거 답변** — 문의 제목+본문을 `text-embedding-3-small`로 임베딩해 `inquiries.embedding`(pgvector, 마이그레이션 0021)에 저장하고 `match_answered_inquiries` RPC로 같은 스코프(게임 하나 또는 서비스 문의)에서 유사도 0.35 이상 상위 5건의 "문의 요약 + 첫 수동 답변"을 가져오며 2건 미만이면 같은 유형 최근 3건으로 보충(`lib/embeddings.ts`, `lib/replies.ts`), (3) **운영 자료** — 게임 문의면 어시스턴트에 연결된 시트·문서 전부를 `loadSources`로 읽어 system 프롬프트 뒤에 싣는다(서비스 문의는 없음). 임베딩은 추천 클릭 시와 수동 답변 발송 시 채우고, 기존 문의는 `scripts/backfill-inquiry-embeddings.js`로 한 번 채운다. 모델은 본문 뒤에 `=== 근거 ===` 구분선과 참고 자료 목록을 쓰고, 화면은 본문만 적용하며 근거는 미리보기 아래에 보여준다(`lib/suggest-evidence.ts`). 자료 읽기 실패·임베딩 실패는 `warning` 이벤트로 본문보다 먼저 내려가고 추천은 계속 만든다. 막히는 건 API 키 없음뿐이다. 설계는 `docs/superpowers/specs/2026-09-07-openai-suggest-design.md`.

상세 설계는 `docs/superpowers/specs/2026-09-01-admin-panel-design.md`, 인박스 화면은 `docs/superpowers/specs/2026-09-03-inbox-layout-design.md`, 자동 답변은 `docs/superpowers/specs/2026-09-03-auto-reply-design.md`, 회신 동기화는 `docs/superpowers/specs/2026-09-07-reply-sync-design.md`, 운영 시트 어시스턴트는 `docs/superpowers/specs/2026-09-04-sheet-assistant-design.md`와 `docs/superpowers/specs/2026-09-07-assistant-sources-design.md`, AI 답변 추천은 `docs/superpowers/specs/2026-09-07-openai-suggest-design.md` 참고.

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
3. 마이그레이션 `0016_auto_reply_delay_5_30.sql`을 실행한다. 지연 범위를 5분~30분으로 바꾸는 트리거 함수 교체뿐이다
4. 예전 방식의 Supabase 웹훅(`inquiries` INSERT → `/api/auto-reply/inquiry`)이 등록돼 있으면 지운다. 그 라우트는 없어졌다
5. 관리자 앱의 게임별 "답변 템플릿" 화면에서 유형별 템플릿을 만들고 "자동 발송 켜기"를 누른다. 같은 유형에 다른 템플릿을 켜면 이전 것은 자동으로 꺼진다
6. 접수 폼에서 테스트 문의를 넣고 5분~30분 뒤 메일이 오는지, 문의함 타임라인에 "자동 발송"으로 보이는지 확인. 실행 기록은 `select * from cron.job_run_details order by start_time desc limit 20;`

## 회신 자동 동기화 설정 절차

1. 두 발신 계정(help@, info@)의 refresh token에 `gmail.readonly` 스코프가 있는지 확인한다. 없으면 `scripts/get-gmail-refresh-token.js`로 다시 발급해 환경변수를 바꾼다
2. 마이그레이션 `0017_reply_sync.sql`을 실행한다. 컬럼·표·건수 RPC를 만들고 `pg_cron` 잡 `reply-sync-run`이 5분마다 `https://admin.theplayplus.com/api/replies/sync`를 호출하게 등록한다. Vault의 `inquiry_webhook_secret`은 자동 답변 설정 때 넣은 것을 그대로 쓴다
3. 테스트 문의에 답변을 보내고 그 메일에 회신한 뒤 5분 안에 목록에 "회신 옴"이 뜨는지 확인. 실행 기록은 `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'reply-sync-run') order by start_time desc limit 20;`

## 운영 시트 어시스턴트 설정 절차

1. Google Cloud 콘솔 → 프로젝트 선택 → "Google Sheets API"와 "Google Docs API" 사용 설정 → IAM → 서비스 계정 만들기 → 키(JSON) 발급
2. 키 파일 내용을 한 줄로 만들어 `GOOGLE_SERVICE_ACCOUNT_JSON`에, OpenAI 키를 `OPENAI_API_KEY`에 넣고 재배포. Node 22 이상에서 실행한다(`openai` 패키지 요구사항; Vercel 프로젝트의 Node 버전을 확인)
3. Supabase SQL Editor에서 `0018_assistant.sql`, `0019_assistant_attachments.sql`, `0020_assistant_sources.sql`을 순서대로 실행. 0018은 anon의 games 조회를 열 단위로 제한한다 — 접수 폼은 id/name/logo_path만 읽는다. 0020는 기존 `games.sheet_id`를 자료 표로 옮기고 열을 지운다
4. 게임 운영 시트·문서를 만든다. 시트를 수정까지 쓰려면 탭 첫 줄에 열 이름을 둔다(예: VIP 탭 = 이메일 / ID / 서버 / 닉네임 / VIP 단계 / 갱신일)
5. 안내된 서비스 계정 이메일에 각 시트·문서를 편집자로 공유한 뒤, 관리자 페이지 → 게임 문의함 → "운영 어시스턴트" → 사이드바 "+ 자료 추가"에 URL을 넣는다
6. 시트는 "52009 VIP 몇이야"로 읽기, "52009 VIP4로 올려줘" → 제안 카드 → [적용] → 시트 반영 확인. 문서는 "환불 정책이 뭐야"처럼 물어 근거에 문서 이름이 붙는지 확인

## AI 답변 추천 설정 절차

1. `OPENAI_API_KEY`가 설정돼 있어야 한다(어시스턴트와 공유). Gemini 키는 더 이상 쓰지 않는다
2. Supabase SQL Editor에서 `0021_inquiry_embeddings.sql`을 실행한다. pgvector 확장, `inquiries.embedding`·`embedding_model` 열, HNSW 인덱스, `match_answered_inquiries` RPC를 만든다
3. 로컬에서 `.env.local`에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`를 두고 `node scripts/backfill-inquiry-embeddings.js`를 한 번 실행해 답변이 있는 기존 문의의 임베딩을 채운다. 다시 실행하면 남은 것만 처리한다
4. 문의함에서 "AI 답변 추천"을 눌러 미리보기 아래 "참고한 자료"에 시트·과거 답변이 보이는지, 자료 읽기 실패 시 노란 안내가 뜨는지 확인한다

## 컨벤션

- 관리자 UI는 한국어 전용 (다국어 없음)
- 카테고리/그룹/유형은 하드코딩하지 않고 DB(`inquiry_groups`, `inquiry_types`)에서 게임별로 관리
- 실패해도 되는 부가 작업(로고 업로드, 이메일 발송)이 실패해도 핵심 데이터(게임/문의) 저장은 막지 않는다 — 경고만 표시하고 재시도 가능하게 함
- Supabase 자격 증명, Gmail OAuth 관련 값은 절대 코드/문서에 평문으로 커밋하지 않는다 — `.env`로만 관리
