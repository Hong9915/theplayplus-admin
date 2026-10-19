"use client";

import { useEffect, useRef, type AnimationEvent, type MouseEvent, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 모달 대화상자. 열리면 안쪽으로 초점을 옮기고(data-autofocus가 있으면 그것, 없으면 첫 컨트롤),
 * Tab이 밖으로 나가지 않게 가두고, Esc·바깥 클릭으로 닫으며, 닫히면 열었던 요소로 초점을 되돌린다.
 * 닫기를 막아야 할 때(요청 진행 중)는 dismissDisabled를 켠다.
 * 대화상자 안에서 또 대화상자를 열 수 있다(서랍 안의 삭제 확인 등). 키보드는 가장 안쪽 것만 받는다.
 * placement="right"는 오른쪽 가장자리에 붙는 서랍이다.
 */
export default function Dialog({
  label,
  labelledBy,
  onClose,
  dismissDisabled = false,
  className = "",
  backdropClassName = "",
  placement = "center",
  onAnimationEnd,
  children,
}: {
  label?: string;
  labelledBy?: string;
  onClose: () => void;
  dismissDisabled?: boolean;
  className?: string;
  backdropClassName?: string;
  placement?: "center" | "right";
  /** 패널 자신의 애니메이션이 끝났을 때만 부른다. 안쪽 요소의 애니메이션은 거른다. */
  onAnimationEnd?: () => void;
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
      // 안쪽에 열린 대화상자가 있으면 그쪽이 처리한다. 패널은 포털 없이 그 자리에 그려지므로 DOM으로 알 수 있다.
      if (panel?.querySelector('[role="dialog"][aria-modal="true"]')) return;
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

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onAnimationEnd?.();
  }

  const right = placement === "right";
  const backdrop = right
    ? "fixed inset-0 z-50 bg-ink/40 flex justify-end overscroll-contain"
    : "fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-6 overscroll-contain";
  const surface = right
    ? "bg-panel h-full w-full shadow-lift overflow-y-auto overscroll-contain focus:outline-none"
    : "bg-panel rounded-2xl border border-line shadow-xl w-full max-h-full overflow-y-auto overscroll-contain p-6 focus:outline-none";

  return (
    <div className={`${backdrop} ${backdropClassName}`.trim()} onClick={onBackdropClick}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onAnimationEnd={handleAnimationEnd}
        className={`${surface} ${className}`.trim()}
      >
        {children}
      </div>
    </div>
  );
}
