import { useEffect } from "react";
import { isMobileViewport } from "./useIsMobile";

const HOLD_MS = 480;
const MOVE_TOLERANCE = 10;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'input, textarea, select, [contenteditable="true"], [data-longpress="off"], a[href]',
  );
}

/**
 * Touch has no right click, so a held finger opens the same actions menu the
 * desktop opens on context menu. The synthetic contextmenu event bubbles to
 * React's delegated handler, which means every existing onContextMenu
 * continues to work unchanged.
 */
export function useLongPressMenus(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;
    let target: Element | null = null;
    let suppressClick: (() => void) | null = null;

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      target = null;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || event.button !== 0) return;
      if (isEditable(event.target)) return;
      const element = event.target instanceof Element ? event.target : null;
      if (!element) return;
      startX = event.clientX;
      startY = event.clientY;
      target = element;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!target) return;
        target.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
            buttons: 2,
            clientX: startX,
            clientY: startY,
          }),
        );
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate?.(8);
        }

        // Lifting the finger after the menu opened would otherwise deliver a
        // normal click to the row underneath (opening the editor on top of the
        // sheet). Swallow exactly that release, and only for a short window.
        suppressClick?.();
        const stop = (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          suppressClick?.();
        };
        const timerId = window.setTimeout(() => suppressClick?.(), 700);
        suppressClick = () => {
          window.clearTimeout(timerId);
          document.removeEventListener("click", stop, true);
          suppressClick = null;
        };
        document.addEventListener("click", stop, true);
      }, HOLD_MS);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!timer) return;
      if (
        Math.abs(event.clientX - startX) > MOVE_TOLERANCE ||
        Math.abs(event.clientY - startY) > MOVE_TOLERANCE
      ) {
        clear();
      }
    };

    const onPointerUp = () => clear();

    // WKWebView opens its own text/image callout on a long press. The app's
    // menus are the only long-press affordance, so suppress the native one.
    const onContextMenu = (event: MouseEvent) => {
      if (isEditable(event.target)) return;
      event.preventDefault();
    };

    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerup", onPointerUp, { passive: true });
    document.addEventListener("pointercancel", onPointerUp, { passive: true });
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      clear();
      suppressClick?.();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [enabled]);
}

/** Only touch shells should pay for the listeners. */
export function useLongPressMenusHere(): void {
  useLongPressMenus(isMobileViewport());
}
