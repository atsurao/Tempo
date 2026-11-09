import type { PaneKind } from "../store/ui";

/**
 * Which views navigation can hold, and the rules for showing them. Keeping
 * this apart from the store means the phone bar, the desktop rail and
 * Settings → Navigation all agree on the same set, order and limits.
 */
export const NAV_VIEW_IDS: PaneKind[] = [
  "today",
  "widgets",
  "calendar",
  "tasks",
  "habits",
  "projects",
  "goals",
  "notes",
  "focus",
];

/** Four tabs plus More fit a phone bar without shrinking the labels. */
export const MOBILE_BAR_LIMIT = 4;

export const DEFAULT_MOBILE_ORDER: PaneKind[] = [...NAV_VIEW_IDS];

/** The views that start under More rather than in the bar. */
export const DEFAULT_MOBILE_HIDDEN: PaneKind[] = [
  "habits",
  "goals",
  "notes",
  "focus",
  "widgets",
];

/** The desktop rail starts with every view, in its long-standing order. */
export const DEFAULT_RAIL_ORDER: PaneKind[] = [...NAV_VIEW_IDS];

export function isViewId(value: string): value is PaneKind {
  return (NAV_VIEW_IDS as string[]).includes(value);
}

/**
 * A saved order can predate a view, or lose one to an older build. Unknown
 * ids are dropped and anything missing is appended, so every view always has
 * a row in Settings and an item in the nav.
 */
export function normalizeOrder(order: readonly string[] | undefined): PaneKind[] {
  const next: PaneKind[] = [];
  for (const id of [...(order ?? []), ...NAV_VIEW_IDS]) {
    if (!isViewId(id) || next.includes(id)) continue;
    next.push(id);
  }
  return next;
}

export function cleanHidden(hidden: readonly string[] | undefined): PaneKind[] {
  return [...new Set((hidden ?? []).filter(isViewId))];
}

/** The ids actually drawn, in their saved order. */
export function visibleViews(
  order: readonly string[],
  hidden: readonly string[],
): PaneKind[] {
  return order.filter((id): id is PaneKind => isViewId(id) && !hidden.includes(id));
}

export function moveView(
  order: readonly PaneKind[],
  from: number,
  to: number,
): PaneKind[] {
  if (from === to || from < 0 || from >= order.length || to < 0 || to >= order.length) {
    return [...order];
  }
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Applies a new order for the visible entries of a nav list and leaves
 * hidden entries in their slots. An in-place drag only knows the tabs on
 * screen; the store still has to remember where the hidden views belong.
 */
export function reorderVisible(
  order: readonly PaneKind[],
  hidden: readonly PaneKind[],
  visible: readonly PaneKind[],
): PaneKind[] {
  const expected = visibleViews(order, hidden);
  if (visible.length !== expected.length) return [...order];
  const wanted = new Set(visible);
  if (expected.some((id) => !wanted.has(id))) return [...order];
  let cursor = 0;
  return order.map((id) => (hidden.includes(id) ? id : visible[cursor++]));
}

/**
 * Turning a view on in the phone bar fails when the bar is already full, and
 * turning the last one off would leave only More. Callers treat null as "no
 * change"; the switch in Settings explains why it is disabled.
 */
export function toggleBarView(
  order: readonly PaneKind[],
  hidden: readonly PaneKind[],
  id: PaneKind,
): PaneKind[] | null {
  const shown = visibleViews(order, hidden);
  if (hidden.includes(id)) {
    if (shown.length >= MOBILE_BAR_LIMIT) return null;
    return hidden.filter((view) => view !== id);
  }
  if (shown.length <= 1) return null;
  return [...hidden, id];
}
