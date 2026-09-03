-- 접수번호 채번 트리거의 자릿수 잘림 수정.
--
-- 0002의 lpad(n::text, 4, '0')는 채우기만 하는 게 아니라 4자리로 *자른다*.
-- 하루 10,000번째 문의는 n=10000 → '1000'이 되어 1,000번과 같은 번호가
-- 나오고, inquiries_inquiry_no_key 유일 제약에 걸려 접수 자체가 실패한다.
-- 4자리 미만만 0으로 채우고 그 이상은 그대로 둔다 (R-20260903-10000).
--
-- 함수 본문만 바꾸므로 트리거는 다시 만들 필요가 없다. security definer와
-- 빈 search_path는 0002와 같은 이유로 유지한다 — anon insert가 RLS에
-- 막히면 문의 접수가 실패한다.
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

  new.inquiry_no := 'R-' || to_char(d, 'YYYYMMDD') || '-' || lpad(n::text, greatest(4, length(n::text)), '0');
  return new;
end $$;
