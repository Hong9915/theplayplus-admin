"use client";

import { useEffect, useState } from "react";
import { withTitleCount } from "@/lib/notification-count";

/** 탭이 가려져 있을 때 RealtimeRefresh가 새 건수를 알려 주는 window 이벤트. */
export const TITLE_COUNT_EVENT = "admin:notification-count";

/**
 * 브라우저 탭 제목 앞에 알림 건수를 붙인다 — Gmail의 "Inbox (1,094)"처럼.
 * 서버 렌더가 준 `count`가 기본이고, 탭이 가려진 동안에는 RealtimeRefresh가 보내는
 * 이벤트로 바뀐다. Next가 화면 이동 때 제목을 다시 쓰면 건수를 다시 붙인다.
 */
export default function TitleCount({ count }: { count: number }) {
  const [current, setCurrent] = useState(count);

  useEffect(() => {
    setCurrent(count);
  }, [count]);

  useEffect(() => {
    const onCount = (event: Event) => {
      const next = (event as CustomEvent<number>).detail;
      if (typeof next === "number") setCurrent(next);
    };
    window.addEventListener(TITLE_COUNT_EVENT, onCount);
    return () => window.removeEventListener(TITLE_COUNT_EVENT, onCount);
  }, []);

  useEffect(() => {
    const apply = () => {
      const next = withTitleCount(document.title, current);
      if (document.title !== next) document.title = next;
    };
    apply();
    // 화면 이동 때 Next가 <title>을 바꾸면 건수가 떨어져 나가므로 다시 붙인다.
    // apply는 이미 맞으면 쓰지 않아 관찰자가 스스로를 계속 부르지 않는다.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = withTitleCount(document.title, 0);
    };
  }, [current]);

  return null;
}
