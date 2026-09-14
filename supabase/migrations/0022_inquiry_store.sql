-- 참조용 사본. 원본은 theplayplus-web 저장소의 supabase/migrations/0009_inquiry_store.sql이며
-- 같은 Supabase 프로젝트에 한 번만 실행한다.

-- 결제/환불 문의에 "스토어 종류"를 필수로 받는다.
--   inquiry_types.collects_store : 이 유형이 스토어 종류를 받는지 (결제·환불 유형은 true)
--   inquiries.store              : 선택한 스토어 키 — google_play / app_store / onestore / other
-- 표기는 접수 폼이 언어별로, 관리자 페이지가 한국어로 바꿔 보여준다. Safe to re-run.

alter table inquiry_types add column if not exists collects_store boolean not null default false;
alter table inquiries add column if not exists store text;

alter table inquiries drop constraint if exists inquiries_store_check;
alter table inquiries
  add constraint inquiries_store_check
  check (store is null or store in ('google_play', 'app_store', 'onestore', 'other'));

-- 모든 게임의 결제·환불 유형에 켠다.
update inquiry_types t
   set collects_store = true
  from inquiry_groups g
 where t.group_id = g.id
   and g.key = 'payment_refund'
   and t.key in ('payment', 'refund');
