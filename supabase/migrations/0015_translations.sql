-- 대화 열 말풍선의 번역문 저장.
--
-- 관리자가 문의 본문·회신·보낸 답변을 우클릭해 "한국어로 번역" / "중국어(간체)로
-- 번역"을 누르면 DeepL 결과를 여기에 둔다. 언어별 컬럼 대신 jsonb 한 칸에
-- {"ko": "...", "zh": "..."} 형태로 담아, 언어가 늘어도 컬럼을 더 만들지 않는다.
-- 다시 번역하면 그 언어 값만 덮어쓴다.

alter table inquiries add column if not exists translations jsonb not null default '{}'::jsonb;
alter table inquiry_messages add column if not exists translations jsonb not null default '{}'::jsonb;
