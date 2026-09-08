-- 자동 답변 지연을 30분~1시간에서 5분~30분으로 줄인다.
--
-- 0014의 트리거 함수만 바꾼다. 컬럼·인덱스·트리거·RPC·pg_cron 잡은 그대로다.
-- 이미 예정된(auto_reply_due_at이 찬) 건은 예전 시각대로 나가고, 이 뒤로
-- 접수되는 건부터 새 범위가 적용된다.

create or replace function assign_auto_reply_due() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.auto_reply_due_at is not null then
    return new;
  end if;

  if new.game_id is not null and exists (
    select 1 from public.reply_templates t
    where t.game_id = new.game_id and t.auto_send
  ) then
    -- 5분 + 0~25분 랜덤 = 5분~30분 뒤.
    new.auto_reply_due_at := now() + interval '5 minutes' + (random() * interval '25 minutes');
  end if;

  return new;
end $$;
