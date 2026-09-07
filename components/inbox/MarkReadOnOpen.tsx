"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 읽지 않은 사용자 회신이 있는 문의를 열면 "회신 옴" 표시를 지운다. 서버 렌더
 * 중에 DB를 고치지 않으려고 클라이언트에서 한 번 부른다. 실패하면 조용히
 * 넘어가고 다음 열람 때 다시 시도한다.
 */
export default function MarkReadOnOpen({ inquiryId }: { inquiryId: string }) {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/inquiries/${inquiryId}/mark-read`, { method: "POST" })
      .then((response) => {
        if (!cancelled && response.ok) router.refresh();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [inquiryId, router]);
  return null;
}
