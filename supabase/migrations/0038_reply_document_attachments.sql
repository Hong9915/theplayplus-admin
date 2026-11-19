-- 답변에 PDF·엑셀을 붙일 수 있게 첨부 버킷이 받는 형식에 문서 세 종류를 더한다.
-- 사진과 같은 inquiry-attachments 버킷·{문의id}/messages/ 경로를 쓰고, 파일당 5MB 상한은 그대로다
-- (lib/attachment-rules.ts의 MAX_IMAGE_BYTES). 웹 접수 폼은 자기 쪽에서 사진만 받으므로 영향이 없다.
-- 기존 허용 목록은 유지하고 빠진 것만 더한다. 목록이 null(제한 없음)이면 건드리지 않는다.
-- 다시 실행해도 같은 결과다.
update storage.buckets
set allowed_mime_types = array(
  select distinct unnest(
    allowed_mime_types || array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ]::text[]
  )
)
where id = 'inquiry-attachments'
  and allowed_mime_types is not null;

-- 확인: select id, allowed_mime_types, file_size_limit from storage.buckets where id = 'inquiry-attachments';
