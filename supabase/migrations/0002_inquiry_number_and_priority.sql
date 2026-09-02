-- 접수번호(R-YYYYMMDD-NNNN)와 우선순위를 추가한다.
--
-- 채번을 DB 트리거에서 하는 이유: theplayplus-contact의 접수 폼은 이
-- 저장소의 API를 거치지 않고 anon 권한으로 inquiries에 직접 insert한다
-- (0001의 "Allow public insert on inquiries" 정책). 앱 레이어에서 번호를
-- 붙이면 그 경로로 들어온 문의에는 번호가 빠진다.

alter table inquiries add column if not exists inquiry_no text;
alter table inquiries add column if not exists priority text not null default 'normal';

create table if not exists inquiry_number_seq (
  seq_date date primary key,
  last_seq  int  not null default 0
);

-- inquiry_number_seq는 채번용 내부 테이블이라 클라이언트가 읽거나 쓸 이유가
-- 없다. RLS를 켜고 정책을 하나도 두지 않아 anon/authenticated를 전면 차단한다.
-- 관리자 앱은 service-role 클라이언트라 RLS를 우회하고, 트리거는 아래처럼
-- security definer로 돌아 우회한다.
alter table inquiry_number_seq enable row level security;

-- 날짜는 Asia/Seoul 기준. created_at은 timestamptz(UTC 저장)이므로 변환
-- 없이 자르면 한국 시간 오전 9시 이전 접수 건이 전날로 밀린다.
--
-- security definer가 필수다: theplayplus-contact의 접수 폼은 anon 권한으로
-- inquiries에 insert하고, 기본값인 security invoker면 이 트리거도 anon으로
-- 실행되어 위에서 켠 RLS에 막힌다. 그러면 문의 접수 자체가 실패한다.
-- search_path를 비우고 스키마를 명시해 검색 경로 하이재킹을 막는다.
create or replace function assign_inquiry_no() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  d date;
  n int;
begin
  if new.inquiry_no is not null then
    return new;
  end if;

  d := (coalesce(new.created_at, now()) at time zone 'Asia/Seoul')::date;

  insert into public.inquiry_number_seq as s (seq_date, last_seq)
  values (d, 1)
  on conflict (seq_date) do update set last_seq = s.last_seq + 1
  returning s.last_seq into n;

  new.inquiry_no := 'R-' || to_char(d, 'YYYYMMDD') || '-' || lpad(n::text, 4, '0');
  return new;
end $$;

drop trigger if exists inquiries_assign_no on inquiries;
create trigger inquiries_assign_no
  before insert on inquiries
  for each row execute function assign_inquiry_no();

-- 기존 문의 소급 부여. KST 날짜별로 묶고 created_at 오름차순, 동률이면
-- id 오름차순으로 번호를 매긴다. 정렬 기준을 못 박아야 재실행해도 같은
-- 결과가 나온다.
with numbered as (
  select
    id,
    (created_at at time zone 'Asia/Seoul')::date as seq_date,
    row_number() over (
      partition by (created_at at time zone 'Asia/Seoul')::date
      order by created_at, id
    ) as seq
  from inquiries
  where inquiry_no is null
)
update inquiries i
set inquiry_no = 'R-' || to_char(n.seq_date, 'YYYYMMDD') || '-' || lpad(n.seq::text, 4, '0')
from numbered n
where i.id = n.id;

-- 소급 부여한 날짜들의 최대 번호를 시퀀스에 심어 이후 채번이 이어지게 한다.
insert into inquiry_number_seq (seq_date, last_seq)
select
  (created_at at time zone 'Asia/Seoul')::date as seq_date,
  count(*)::int as last_seq
from inquiries
group by 1
on conflict (seq_date) do update
  set last_seq = greatest(inquiry_number_seq.last_seq, excluded.last_seq);

-- 유일 제약은 반드시 소급 부여 뒤에 건다. 먼저 걸면 null이 여러 개라
-- 통과하지만, 순서를 지켜야 백필 결과를 즉시 검증하는 효과가 있다.
alter table inquiries drop constraint if exists inquiries_inquiry_no_key;
alter table inquiries add constraint inquiries_inquiry_no_key unique (inquiry_no);
