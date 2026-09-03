-- 유형별 매크로 자동 답변.
--
-- reply_templates.auto_send가 켜진 템플릿은 그 유형의 새 문의가 들어올 때
-- /api/auto-reply/inquiry 웹훅이 바로 이메일로 보낸다. 같은 게임·유형에
-- 자동 발송 템플릿은 하나만 있어야 어떤 것을 보낼지 애매하지 않다.
-- type_key가 null인 공용 템플릿도 켤 수 있고(유형 전용이 없을 때의 대체),
-- 유니크 인덱스에서 null을 ''로 접어 공용도 하나만 허용한다.
--
-- inquiry_messages.auto_sent는 타임라인에서 "자동 발송"으로 구분해 보여주기
-- 위한 표시다. 관리자가 직접 답한 것으로 착각하지 않게 한다.

alter table reply_templates
  add column if not exists auto_send boolean not null default false;

create unique index if not exists reply_templates_auto_send_key
  on reply_templates (game_id, coalesce(type_key, ''))
  where auto_send;

alter table inquiry_messages
  add column if not exists auto_sent boolean not null default false;
