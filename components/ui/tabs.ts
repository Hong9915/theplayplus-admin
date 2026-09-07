import type { KeyboardEvent } from "react";

/** WAI-ARIA 탭 패턴의 id·속성·키보드 처리. 탭 버튼과 패널이 서로를 가리키고, 화살표로 오간다. */
export function tabId(prefix: string, key: string): string {
  return `${prefix}-tab-${key}`;
}

export function tabPanelId(prefix: string, key: string): string {
  return `${prefix}-panel-${key}`;
}

export function tabProps(prefix: string, key: string, active: boolean) {
  return {
    id: tabId(prefix, key),
    role: "tab" as const,
    type: "button" as const,
    "aria-selected": active,
    "aria-controls": tabPanelId(prefix, key),
    tabIndex: active ? 0 : -1,
  };
}

export function tabPanelProps(prefix: string, key: string) {
  return {
    id: tabPanelId(prefix, key),
    role: "tabpanel" as const,
    "aria-labelledby": tabId(prefix, key),
  };
}

/** 선택된 탭만 Tab 순서에 있고, 좌우 화살표·Home·End로 나머지를 고른다. 고르면 초점도 따라간다. */
export function handleTabListKeyDown<K extends string>(
  event: KeyboardEvent,
  keys: readonly K[],
  current: K,
  prefix: string,
  onChange: (next: K) => void
): void {
  const index = keys.indexOf(current);
  let next: K | undefined;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      next = keys[(index + 1) % keys.length];
      break;
    case "ArrowLeft":
    case "ArrowUp":
      next = keys[(index - 1 + keys.length) % keys.length];
      break;
    case "Home":
      next = keys[0];
      break;
    case "End":
      next = keys[keys.length - 1];
      break;
    default:
      return;
  }
  if (next === undefined) return;
  event.preventDefault();
  onChange(next);
  document.getElementById(tabId(prefix, next))?.focus();
}
