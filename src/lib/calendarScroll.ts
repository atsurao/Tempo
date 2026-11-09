/**
 * Keyboard scrolling for the calendar.
 *
 * Only one calendar view is mounted at a time, and each owns its own scroll
 * element. A global shortcut cannot reach those elements directly, so it
 * announces a direction here and the mounted view moves itself. Keeping this
 * out of the store avoids a React render for every arrow press.
 */
export type ScrollDir = "up" | "down";
type ScrollHandler = (dir: ScrollDir, page: boolean) => void;

const handlers = new Set<ScrollHandler>();

/** Listen for keyboard scroll requests; returns the unsubscribe function. */
export function onCalendarScroll(handler: ScrollHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/** Ask the mounted calendar view to scroll by a line or a page. */
export function scrollCalendar(dir: ScrollDir, page = false): void {
  for (const handler of handlers) handler(dir, page);
}
