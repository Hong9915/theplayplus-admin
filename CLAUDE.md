# theplayplus-admin

THE PLAY+ 고객지원 관리자 페이지. `theplayplus-contact`(문의 접수 폼) 저장소와 **같은 Supabase 프로젝트를 공유**하는 별도 저장소다. 여기서 만든 코드도 나중에 사람이 직접 메인 사이트 저장소로 복사해 붙여넣는 방식으로 통합될 예정이다.

## 핵심 기능

1. **게임 관리** — 게임 추가(이름/상태 필수, 로고 선택, 게임별 문의 카테고리 커스터마이징), 게임 목록에서 선택
2. **게임별 문의 목록** — 선택한 게임에 접수된 문의를 조회, 상태 변경(new/처리중/완료)
3. **문의 답변 발송** — 문의 상세에서 답변을 작성해 Gmail API로 `info@theplayplus.com` 계정으로 바로 발송. 발송 성공 시 상태가 자동으로 `처리중`으로 바뀌고 답변 내용이 기록됨 (`완료`는 관리자가 직접 변경)
4. **계정 이력 패널** — 문의 상세에서 같은 게임 내 동일 `game_account`의 과거 문의 이력을 함께 보여줌 (이벤트 참여 이력은 현재 데이터 소스가 없어 확장 지점만 마련)

상세 설계는 `docs/superpowers/specs/2026-09-01-admin-panel-design.md` 참고.

## 기술 스택

- Next.js 14 (App Router, TypeScript) + Tailwind CSS
- Supabase (Postgres + Auth + Storage) — `theplayplus-contact`와 동일 프로젝트 공유
- Supabase Auth (이메일+비밀번호, 여러 관리자 계정 가능, 역할 구분 없음)
- Gmail API (`googleapis`) — 답변 이메일 발송
- Vitest + React Testing Library

## 컨벤션

- 관리자 UI는 한국어 전용 (다국어 없음)
- 카테고리/그룹/유형은 하드코딩하지 않고 DB(`inquiry_groups`, `inquiry_types`)에서 게임별로 관리
- 실패해도 되는 부가 작업(로고 업로드, 이메일 발송)이 실패해도 핵심 데이터(게임/문의) 저장은 막지 않는다 — 경고만 표시하고 재시도 가능하게 함
- Supabase 자격 증명, Gmail OAuth 관련 값은 절대 코드/문서에 평문으로 커밋하지 않는다 — `.env`로만 관리
