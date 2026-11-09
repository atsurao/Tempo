import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

const DISMISS_DISTANCE = 84;
const FLING_DISTANCE = 28;
const FLING_VELOCITY = 0.55;
const MOTION_MS = 180;

interface Options {
  enabled: boolean;
  onDismiss: () => void;
}

interface DragState {
  pointerId: number;
  startY: number;
  startAt: number;
  lastY: number;
}

function clearSheetStyles(sheet: HTMLElement) {
  sheet.style.transition = "";
  sheet.style.transform = "";
  sheet.style.opacity = "";
  sheet.style.willChange = "";
  delete sheet.dataset.swiping;
}

/**
 * A bottom sheet can be dismissed by dragging its grabber down. The pointer is
 * captured by the grabber, so the gesture survives leaving the narrow handle.
 * A short flick works as well as a deliberate pull.
 */
export function useSwipeDownDismiss<T extends HTMLElement>(
  sheetRef: RefObject<T | null>,
  { enabled, onDismiss }: Options,
) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const dragRef = useRef<DragState | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      dragRef.current = null;
    },
    [],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || !event.isPrimary || event.button !== 0) return;
    const sheet = sheetRef.current;
    if (!sheet) return;

    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // The entry animation owns the transform briefly after opening. A gesture
    // takes it over, then leaves the settled sheet in place.
    sheet.style.animation = "none";
    sheet.style.transition = "none";
    sheet.style.transform = "translate3d(0, 0, 0)";
    sheet.style.willChange = "transform";
    sheet.dataset.swiping = "true";
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startAt: performance.now(),
      lastY: event.clientY,
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers and older WebViews can reject capture. The move
      // handlers still work while the pointer stays over the handle.
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet || event.pointerId !== drag.pointerId) return;
    const distance = Math.max(0, event.clientY - drag.startY);
    drag.lastY = event.clientY;
    sheet.style.transform = `translate3d(0, ${distance}px, 0)`;
    event.preventDefault();
  };

  const finish = (
    event: ReactPointerEvent<HTMLElement>,
    cancelled: boolean,
  ) => {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const elapsed = Math.max(16, performance.now() - drag.startAt);
    const distance = Math.max(0, drag.lastY - drag.startY);
    const velocity = distance / elapsed;
    const shouldDismiss =
      !cancelled &&
      (distance >= DISMISS_DISTANCE ||
        (distance >= FLING_DISTANCE && velocity >= FLING_VELOCITY));
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const duration = reduced ? 0 : MOTION_MS;

    sheet.dataset.swiping = "false";
    sheet.style.transition = `transform ${duration}ms var(--ease), opacity ${duration}ms linear`;
    sheet.style.transform = shouldDismiss
      ? "translate3d(0, calc(100% + 32px), 0)"
      : "translate3d(0, 0, 0)";
    if (shouldDismiss) sheet.style.opacity = "0";

    if (duration === 0) {
      if (shouldDismiss) dismissRef.current();
      else clearSheetStyles(sheet);
      return;
    }

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (shouldDismiss) dismissRef.current();
      else clearSheetStyles(sheet);
    }, duration + 10);
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => finish(event, false),
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => finish(event, true),
  };
}
