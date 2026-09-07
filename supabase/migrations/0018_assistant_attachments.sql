-- 운영 어시스턴트 메시지 첨부: 원본 파일은 보관하지 않고 뽑아낸 텍스트만 남긴다.
-- [{ "name": "보상.txt", "size": 1234, "text": "..." }]

alter table assistant_messages add column if not exists attachments jsonb;
