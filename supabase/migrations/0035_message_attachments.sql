-- 답변·회신에 딸린 사진. 문의 본문 첨부와 같은 표·같은 버킷(inquiry-attachments)을 쓰고
-- message_id로 어느 메시지의 사진인지 구분한다. null이면 접수 폼에서 올린 문의 본문 첨부다.
--  - 관리자가 답변에 붙여 보낸 사진: 발송 뒤 그 outbound 메시지 id로 넣는다.
--  - 사용자가 Gmail 회신에 붙인 사진: 회신 동기화가 inbound 메시지 id로 넣는다.
-- inquiry_id도 함께 채우므로 문의 삭제 시 기존 cascade·파일 정리가 그대로 동작한다.
alter table inquiry_attachments
  add column if not exists message_id uuid references inquiry_messages(id) on delete cascade;

create index if not exists inquiry_attachments_message_id_idx
  on inquiry_attachments (message_id) where message_id is not null;
