-- 새 문의가 들어오면 /api/notify/inquiry 를 불러 Slack·Discord 알림을 보낸다.
--
-- 예전에는 Supabase 대시보드의 Database Webhook으로 걸었는데, 2026-10-20 새 프로젝트로
-- 옮기면서 대시보드 설정은 따라오지 않았다. 다른 cron 잡처럼 pg_net + Vault 비밀값으로
-- 코드에 남겨 둔다. payload 모양은 Database Webhook과 같다({type, table, record}).
--
-- 실행 전에: 대시보드 → Database → Webhooks에 inquiries INSERT 웹훅이 남아 있으면 지운다.
-- 둘 다 있으면 알림이 두 번 간다. 아래로도 확인할 수 있다(이 파일의 트리거 말고 다른 것이 나오면 그것이 웹훅).
--   select tgname from pg_trigger where tgrelid = 'public.inquiries'::regclass and not tgisinternal;
--
-- Vault의 inquiry_webhook_secret은 자동 답변 설정(0014) 때 넣은 것을 그대로 쓴다.
-- 도메인이 다르면 url을 바꿔 실행한다.

create extension if not exists pg_net;

create or replace function public.notify_new_inquiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://admin.theplayplus.com/api/notify/inquiry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'inquiry_webhook_secret')
    ),
    body := jsonb_build_object('type', 'INSERT', 'table', 'inquiries', 'record', to_jsonb(new)),
    timeout_milliseconds := 10000
  );
  return new;
exception when others then
  -- 알림은 부가 작업이다. 실패해도 문의 접수는 막지 않는다.
  raise warning 'notify_new_inquiry failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists notify_new_inquiry on public.inquiries;
create trigger notify_new_inquiry
  after insert on public.inquiries
  for each row execute function public.notify_new_inquiry();
