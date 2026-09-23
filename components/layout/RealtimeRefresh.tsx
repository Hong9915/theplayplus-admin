"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

/** 여러 건이 한꺼번에 바뀔 때(일괄 상태 변경, 라운지 동기화) 새로고침을 한 번으로 모은다. */
const DEBOUNCE_MS = 1000;

/**
 * 관리자 화면을 실시간으로 갱신한다. DB 트리거가 Supabase Realtime의 `admin:changes`
 * 채널로 "무언가 바뀌었다"만 쏘고(마이그레이션 0025), 여기서 그 신호를 받아 서버
 * 렌더를 다시 돌린다. 화면 코드는 기존 그대로라 새 문의·상태 변경·회신·라운지 글이
 * 목록·배지에 자동으로 반영된다. 탭이 가려져 있으면 보일 때 한 번만 새로고침한다.
 * 연결 실패는 조용히 넘어간다 — 기존의 수동 새로고침으로 돌아갈 뿐이다.
 */
export default function RealtimeRefresh() {
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingWhileHidden = false;

    const refresh = () => {
      if (document.visibilityState === "hidden") {
        pendingWhileHidden = true;
        return;
      }
      router.refresh();
    };

    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refresh();
      }, DEBOUNCE_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !pendingWhileHidden) return;
      pendingWhileHidden = false;
      router.refresh();
    };

    const channel = supabase
      .channel("admin:changes", { config: { private: true } })
      .on("broadcast", { event: "change" }, onChange)
      .subscribe();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
