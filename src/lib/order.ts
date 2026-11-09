/**
 * Reordering a sidebar list means the same two steps every time: move one row
 * to the drop position, then renumber so the stored `order` matches the screen.
 * Kept apart from the rail so the maths is testable without a pointer.
 */

/** Move one row to another index, returning a new array. */
export function moveWithin<T>(rows: readonly T[], from: number, to: number): T[] {
  const next = [...rows];
  if (!Number.isInteger(from) || !Number.isInteger(to)) return next;
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Give every row a fresh 0-based `order`. Rows already in place are returned
 * untouched, so only the rows that actually changed need writing back.
 */
export function renumber<T extends { order: number }>(rows: readonly T[]): T[] {
  return rows.map((row, index) => (row.order === index ? row : { ...row, order: index }));
}
