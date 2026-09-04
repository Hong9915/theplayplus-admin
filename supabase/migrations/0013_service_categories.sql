-- theplayplus-contact 저장소의 0003_service_categories.sql 사본. 공유 DB에는 이미
-- 적용돼 있어 여기서는 아무 일도 하지 않는다(if not exists / on conflict do nothing).
-- 이 저장소만 보고도 서비스 문의(제휴·기타) 카테고리 스키마를 알 수 있게 두는 기록이다.
-- 관리자 앱은 service-role로 읽으므로 아래 anon 정책은 접수 폼용이다. 재실행 안전.
create table if not exists service_groups (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label_ko   text not null,
  label_zh   text,
  label_en   text,
  sort_order int  not null default 0
);

create table if not exists service_types (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null references service_groups(id) on delete cascade,
  key                   text not null,
  label_ko              text not null,
  label_zh              text,
  label_en              text,
  requires_company_name boolean not null default false,
  allow_attachments     boolean not null default true,
  sort_order            int not null default 0,
  unique (group_id, key)
);

alter table service_groups enable row level security;
alter table service_types enable row level security;

drop policy if exists "Allow public read on service_groups" on service_groups;
create policy "Allow public read on service_groups"
  on service_groups for select
  to anon
  using (true);

drop policy if exists "Allow public read on service_types" on service_types;
create policy "Allow public read on service_types"
  on service_types for select
  to anon
  using (true);

insert into service_groups (key, label_ko, label_zh, label_en, sort_order) values
  ('business', '사업 제휴 문의', '业务合作咨询', 'Business Partnership', 0),
  ('other',    '기타 문의',     '其他咨询',     'Other', 1)
on conflict (key) do nothing;

insert into service_types (group_id, key, label_ko, label_zh, label_en, requires_company_name, allow_attachments, sort_order)
select g.id, t.key, t.label_ko, t.label_zh, t.label_en, t.requires_company_name, t.allow_attachments, t.sort_order
from (values
  ('business', 'publishing',  '퍼블리싱 제휴', '发行合作',   'Publishing',           true,  true, 0),
  ('business', 'marketing',   '마케팅 제휴',   '市场合作',   'Marketing',            true,  true, 1),
  ('business', 'investment',  '투자 문의',     '投资咨询',   'Investment',           true,  true, 2),
  ('other',    'press',       '언론·보도 문의', '媒体咨询',  'Press',                false, true, 0),
  ('other',    'general',     '일반 문의',     '一般咨询',   'General',              false, true, 1)
) as t(group_key, key, label_ko, label_zh, label_en, requires_company_name, allow_attachments, sort_order)
join service_groups g on g.key = t.group_key
on conflict (group_id, key) do nothing;
