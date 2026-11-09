import type { Item, Occurrence } from "../types";
import { useUI } from "./ui";

/** Open the item quick look at the pointer, optionally scoped to one occurrence. */
export function openItemMenu(event: React.MouseEvent, item: Item, occ?: Occurrence) {
  event.preventDefault();
  event.stopPropagation();
  // A timetable occurrence is not an item. If the occurrence identifies its
  // weekly session, offer one-off edit/delete; fall back to the schedule menu.
  if (occ?.scheduleId) {
    if (occ.scheduleItemId && occ.scheduleDay != null) {
      useUI.getState().openContextMenu({
        kind: "scheduleOccurrence",
        x: event.clientX,
        y: event.clientY,
        scheduleId: occ.scheduleId,
        scheduleItemId: occ.scheduleItemId,
        scheduleDay: occ.scheduleDay,
        start: occ.start,
        end: occ.end,
      });
    } else {
      openScheduleMenu(event, occ.scheduleId);
    }
    return;
  }
  useUI.getState().openContextMenu({
    kind: "item",
    x: event.clientX,
    y: event.clientY,
    itemId: item.id,
    start: occ?.start,
    end: occ?.end,
    originalStart: occ?.originalStart,
    isDue: occ?.isDue,
  });
}

/** Open the date menu for an overdue task at the postpone button. */
export function openPostponeMenu(event: React.MouseEvent, taskId: string) {
  event.preventDefault();
  event.stopPropagation();
  useUI.getState().openPostponeMenu(taskId, event.clientX, event.clientY);
}

/**
 * Open the menu for empty calendar space. `start` is the slot the pointer was
 * over, so a new event or task lands exactly where the reader clicked.
 */
export function openSlotMenu(event: React.MouseEvent, start: number, allDay = false) {
  event.preventDefault();
  event.stopPropagation();
  useUI.getState().openContextMenu({
    kind: "slot",
    x: event.clientX,
    y: event.clientY,
    start,
    allDay,
  });
}

/** Open the calendar actions menu at the pointer. */
export function openCalendarMenu(event: React.MouseEvent, projectId: string) {
  event.preventDefault();
  event.stopPropagation();
  useUI.getState().openContextMenu({
    kind: "calendar",
    x: event.clientX,
    y: event.clientY,
    projectId,
  });
}

/** Open the work-project actions menu at the pointer. */
export function openWorkProjectMenu(event: React.MouseEvent, workProjectId: string) {
  event.preventDefault();
  event.stopPropagation();
  useUI.getState().openContextMenu({
    kind: "workProject",
    x: event.clientX,
    y: event.clientY,
    workProjectId,
  });
}

/** Open the tag actions menu at the pointer. */
export function openTagMenu(event: React.MouseEvent, tagId: string) {
  event.preventDefault();
  event.stopPropagation();
  useUI.getState().openContextMenu({
    kind: "tag",
    x: event.clientX,
    y: event.clientY,
    tagId,
  });
}

/** Open the timetable actions menu at the pointer. */
export function openScheduleMenu(event: React.MouseEvent, scheduleId: string) {
  event.preventDefault();
  event.stopPropagation();
  useUI.getState().openContextMenu({
    kind: "schedule",
    x: event.clientX,
    y: event.clientY,
    scheduleId,
  });
}
