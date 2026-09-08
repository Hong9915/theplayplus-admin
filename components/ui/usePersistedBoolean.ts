"use client";

import { useEffect, useState } from "react";

/**
 * localStorage에 기억하는 불리언 상태. 서버 렌더와 첫 페인트는 항상 initial 값이고,
 * 마운트 후 저장된 값이 있으면 그 값으로 맞춘다(하이드레이션 불일치를 피하기 위해).
 */
export function usePersistedBoolean(key: string, initial: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) setValue(stored === "true");
  }, [key]);

  function update(next: boolean) {
    setValue(next);
    window.localStorage.setItem(key, String(next));
  }

  return [value, update];
}
