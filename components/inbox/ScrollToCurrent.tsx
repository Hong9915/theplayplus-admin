"use client";

import { useEffect } from "react";

/**
 * 같은 계정의 문의가 여러 건 이어져 있을 때, 열자마자 지금 선택한 문의의
 * 구분선(data-current="true")이 보이도록 스크롤한다.
 */
export default function ScrollToCurrent() {
  useEffect(() => {
    const target = document.querySelector('[data-current="true"]');
    // jsdom 등 scrollIntoView가 없는 환경에서는 조용히 넘어간다.
    if (target instanceof HTMLElement && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "start" });
    }
  }, []);
  return null;
}
