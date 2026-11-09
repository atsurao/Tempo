import type { RefObject } from "react";
import { useSwipeDownDismiss } from "../../hooks/useSwipeDownDismiss";

interface Props<T extends HTMLElement> {
  sheetRef: RefObject<T | null>;
  enabled: boolean;
  onDismiss: () => void;
  className?: string;
}

/** The handle above a phone bottom sheet; swiping it down dismisses the sheet. */
export function SheetDragHandle<T extends HTMLElement>({
  sheetRef,
  enabled,
  onDismiss,
  className,
}: Props<T>) {
  const handlers = useSwipeDownDismiss(sheetRef, { enabled, onDismiss });
  if (!enabled) return null;
  return (
    <div
      className={className ? `sheet-drag-handle ${className}` : "sheet-drag-handle"}
      aria-hidden="true"
      {...handlers}
    >
      <span />
    </div>
  );
}
