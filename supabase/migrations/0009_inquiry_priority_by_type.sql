-- 문의 유형별 기본 우선순위.
--
-- 규칙: 결제·환불·복구 문의는 긴급, 건의 사항은 낮음, 나머지는 보통.
-- 유형은 DB(inquiry_types)에서 게임별로 관리한다는 컨벤션에 맞춰 규칙도
-- 코드가 아니라 유형 행에 둔다. 나중에 게임 설정 화면에서 바꿀 수 있다.
--
-- 트리거로 하는 이유: 접수번호(0002)와 같다. theplayplus-contact의 접수 폼은
-- 이 저장소의 API를 거치지 않고 inquiries에 직접 insert하므로, 앱 레이어에서
-- 정하면 그 경로로 들어온 문의는 전부 'normal'로 남는다.
--
-- 트리거는 insert 시에만 돈다. 관리자가 상세에서 직접 바꾼 값(update)은
-- 건드리지 않는다. insert에 priority를 명시하면 그 값을 그대로 쓴다.

alter table inquiry_types
  add column if not exists default_priority text not null default 'normal';

alter table inquiry_types drop constraint if exists inquiry_types_default_priority_check;
alter table inquiry_types
  add constraint inquiry_types_default_priority_check
  check (default_priority in ('urgent', 'high', 'normal', 'low'));

-- 현재 게임들의 유형에 규칙을 심는다. 키는 라이브 DB 기준이고,
-- payment_refund는 lib/categories.ts의 신규 게임 기본 템플릿 키다.
update inquiry_types set default_priority = 'urgent'
  where key in ('payment', 'refund', 'restore_request', 'payment_refund');
update inquiry_types set default_priority = 'low'
  where key = 'suggestion';

-- 컬럼 기본값 'normal'을 빼야 트리거가 "명시 안 함"과 "명시적 normal"을
-- 구분할 수 있다. not null은 유지하고, 트리거가 항상 값을 채운다.
alter table inquiries alter column priority drop default;

-- security definer가 필요한 이유도 0002와 같다. 접수 폼은 anon 권한으로
-- insert하고 inquiry_types는 anon에 select 정책이 있지만, 앞으로 정책이
-- 바뀌어도 접수가 막히지 않도록 트리거는 소유자 권한으로 돈다.
create or replace function assign_inquiry_priority() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  p text;
begin
  if new.priority is not null then
    return new;
  end if;

  -- 같은 게임의 (그룹 키, 유형 키)로 유형을 찾는다. 게임이 없거나(사업 문의 등)
  -- 유형이 없으면 보통으로 둔다.
  if new.game_id is not null then
    select t.default_priority into p
    from public.inquiry_types t
    join public.inquiry_groups g on g.id = t.group_id
    where g.game_id = new.game_id
      and g.key = new.group_key
      and t.key = new.type_key
    limit 1;
  end if;

  new.priority := coalesce(p, 'normal');
  return new;
end $$;

drop trigger if exists inquiries_assign_priority on inquiries;
create trigger inquiries_assign_priority
  before insert on inquiries
  for each row execute function assign_inquiry_priority();

-- 기존 문의 소급 적용. 관리자가 이미 바꾼 건(normal이 아닌 값)은 그대로 둔다.
-- 지금까지는 모든 문의가 기본값 normal로 들어왔으므로 normal인 건은 전부
-- 손대지 않은 건이다.
update inquiries i
set priority = t.default_priority
from public.inquiry_types t
join public.inquiry_groups g on g.id = t.group_id
where i.priority = 'normal'
  and i.game_id = g.game_id
  and i.group_key = g.key
  and i.type_key = t.key
  and t.default_priority <> 'normal';
