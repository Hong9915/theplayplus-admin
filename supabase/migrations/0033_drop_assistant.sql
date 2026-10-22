-- 운영 시트 어시스턴트와 운영 자료(구글 시트·문서 연결)를 없앤다.
-- AI 답변 추천의 근거는 라운지 운영정책 임베딩(0032)이 대신한다.
--
-- 0018·0019·0020이 만든 표를 지운다. 대화·제안·연결해 둔 자료 목록이 함께 사라진다(구글 시트·문서
-- 자체는 그대로다). 코드는 이 표를 더 이상 읽지 않으므로, 배포 뒤 운영정책 추천이 괜찮은 걸 확인하고
-- 실행한다. 0018의 anon games 열 단위 select 제한은 접수 폼 보안이라 그대로 둔다. 재실행 안전.

drop table if exists assistant_messages;
drop table if exists assistant_conversations;
drop table if exists assistant_sources;
