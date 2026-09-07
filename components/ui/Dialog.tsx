"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 모달 대화상자. 열리면 안쪽으로 초점을 옮기고(data-autofocus가 있으면 그것, 없으면 첫 컨트롤),
 * Tab이 밖으로 나가지 않게 가두고, Esc·바깥 클릭으로 닫으며, 닫히면 열었던 요소로 초점을 되돌린다.
 * 닫기를 막아야 할 때(요청 진행 중)는 dismissDisabled를 켠다.
 */
export default function Dialog({
  label,
  labelledBy,
  onClose,
  dismissDisabled = false,
  className = "",
  children,
}: {
  label?: string;
  labelledBy?: string;
  onClose: () => void;
  dismissDisabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const dismissDisabledRef = useRef(dismissDisabled);
  onCloseRef.current = onClose;
  dismissDisabledRef.current = dismissDisabled;

  useEffect(() => {
    const panel = panelRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

    const preferred = panel?.querySelector<HTMLElement>("[data-autofocus]");
    (preferred ?? focusables()[0] ?? panel)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (dismissDisabledRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && panel.contains(active);
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus();
    };
  }, []);

  function onBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !dismissDisabled) {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-6 overscroll-contain" onClick={onBackdropClick}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`bg-panel rounded-2xl border border-line shadow-xl w-full max-h-full overflow-y-auto overscroll-contain p-6 focus:outline-none ${className}`.trim()}
      >
        {children}
      </div>
    </div>
  );
}
