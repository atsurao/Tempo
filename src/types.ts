export type ItemType = "event" | "task" | "note";
export type TaskStatus = "todo" | "doing" | "done";
/** 0 = none, 1 = low, 2 = medium, 3 = high */
export type Priority = 0 | 1 | 2 | 3;
/** how long a goal is expected to run: a month, a year, or until it is done */
export type GoalSpan = "month" | "year" | "open";

export interface Reminder {
  id: string;
  /** minutes before the item starts / is due */
  offsetMin: number;
}

export interface Recurrence {
  /** RFC 5545 RRULE body, e.g. "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1" */
  rrule: string;
}

/**
 * One stretch of calendar time set aside for a task. A task may have several,
 * and each carries its own repeat rule: a weekly reading block and a one-off
 * exam revision block can belong to the same piece of work.
 */
export interface TimeBlock {
  id: string;
  start: number;
  end: number;
  /** The block alone repeats; the task itself never does. */
  recurrence?: Recurrence | null;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  body?: string;

  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;

  /** presentation */
  color?: string | null;
  location?: string;
  url?: string;

  /** grouping */
  projectId?: string | null;
  tagIds?: string[];

  /** calendar placement */
  start?: number | null;
  end?: number | null;
  allDay?: boolean;

  /** task fields */
  dueAt?: number | null;
  /**
   * Due on the day rather than at a time — a reading assignment is due Friday,
   * not at 23:59. Stored with `dueAt` at the end of that day.
   */
  dueAllDay?: boolean;
  /**
   * Calendar stretches booked for this task. `start`/`end` mirror the first
   * block for the views that still read a single placement.
   */
  timeblocks?: TimeBlock[];
  status?: TaskStatus;
  priority?: Priority;
  parentId?: string | null;
  order?: number;
  estimateMin?: number | null;
  completedAt?: number | null;
  /** Manual progress for project work, 0–100. Done still reads as 100. */
  progressPct?: number | null;

  /**
   * Work-project membership and Gantt scheduling. Ordinary items leave these
   * undefined; calendar placement stays in `start`/`end`, which the project
   * scheduler never rewrites.
   */
  workProjectId?: string | null;
  /** Auto tasks take their dates from dependencies; manual tasks are pinned. */
  scheduleMode?: "auto" | "manual";
  /** Working days a project task takes; milestones are zero. */
  durationDays?: number | null;
  /** Gantt dates, day granularity, computed or pinned per `scheduleMode`. */
  plannedStart?: number | null;
  plannedEnd?: number | null;
  milestone?: boolean;
  /** Member ids from the owning project's roster. */
  assigneeIds?: string[];

  /** recurrence */
  recurrence?: Recurrence | null;
  /** set on exception instances that belong to a recurring master */
  recurrenceParentId?: string | null;
  /** the original occurrence start this exception replaces */
  originalStart?: number | null;
  /** the time block a recurring exception belongs to, when it has one */
  recurrenceBlockId?: string | null;
  /** true when this specific occurrence was deleted from a series */
  cancelled?: boolean;

  reminders?: Reminder[];

  /** iCalendar UID this item was imported from, used to skip re-imports */
  sourceUid?: string | null;
}

/**
 * Something to do again and again on a schedule — practice, reading, a walk.
 * Deliberately not a task: it is never "finished", only done on a given day,
 * so its history is the record rather than a status.
 */
export interface Habit {
  id: string;
  name: string;
  /** Weekdays it runs on, 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Every N weeks; 1 is every week. */
  interval: number;
  color: string;
  note?: string;
  /** First day it runs, as a day start. */
  start: number;
  archivedAt?: number | null;
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** One day a habit was done. The id is `habitId:dayStart`, so a day is once. */
export interface HabitCheckin {
  id: string;
  habitId: string;
  /** Day start of the day it was done on. */
  day: number;
  createdAt: number;
}

/**
 * A long-term goal. Deliberately not an Item: goals are not placed on the
 * clock the way events and tasks are, they span a stretch of time and end
 * when the work is done. The calendar and the task timeline read them as
 * ranges, but nothing else in the app has to change.
 */
export interface Goal {
  id: string;
  title: string;
  body?: string;
  span: GoalSpan;
  /** day start the goal begins */
  start: number;
  /** day end of the horizon, or null for a goal that runs until completion */
  end?: number | null;
  projectId?: string | null;
  color?: string | null;
  completedAt?: number | null;
  order?: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  order: number;
  archived?: boolean;
  /**
   * Hidden from the calendar and the task/Today views. The calendar and its
   * items still exist; this is only a view preference.
   */
  hidden?: boolean;
}

/**
 * A fixed weekly timetable — a term of classes — rather than a set of one-off
 * events. Sessions repeat on chosen weekdays until a break takes them out, so
 * the same schedule describes a whole semester without an entry per lecture.
 */
export interface Schedule {
  id: string;
  name: string;
  color: string;
  order: number;
  /** First day the timetable runs, as a day start. */
  from: number;
  /** Last day it runs, as a day start; that day is included. */
  to: number;
  createdAt: number;
  updatedAt: number;
  /**
   * Hidden from the calendar and Today. The timetable and its sessions still
   * exist; this is only a view preference.
   */
  hidden?: boolean;
}

/** One weekly slot in a schedule: a class, a lab, a shift. */
export interface ScheduleItem {
  id: string;
  scheduleId: string;
  name: string;
  /** Weekdays it runs on, 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Minutes from midnight, local time. */
  startMin: number;
  endMin: number;
  location?: string;
  order: number;
}

/**
 * A stretch the timetable does not run: reading week, a holiday, an exam week.
 * Both endpoints are day starts and both are included, so a one-day break has
 * `from === to`.
 */
export interface ScheduleBreak {
  id: string;
  scheduleId: string;
  label: string;
  from: number;
  to: number;
}

/**
 * A one-off change to a generated timetable session. The weekly plan is left
 * alone: this row targets exactly one session on one day, either replacing its
 * title, place and time, or hiding it.
 */
export interface ScheduleException {
  id: string;
  scheduleId: string;
  sessionId: string;
  /** Day start of the occurrence this exception belongs to. */
  day: number;
  kind: "edit" | "delete";
  title?: string;
  location?: string;
  /** Minutes from midnight; only meaningful for an edit. */
  startMin?: number;
  endMin?: number;
  updatedAt: number;
}

export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

/**
 * A piece of work with a plan behind it, as opposed to a calendar: tasks,
 * dependencies, milestones and a team. Members are local labels, not accounts.
 */
export interface WorkProject {
  id: string;
  name: string;
  description?: string;
  color: string;
  /** Default calendar for tasks created here; tasks may override it. */
  calendarId?: string | null;
  /** First working day, as a day start. */
  start: number;
  /** Optional promised date, as a day end. */
  deadline?: number | null;
  /** Weekdays the plan may use, 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  archivedAt?: number | null;
  memberIds: string[];
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** A person who can be assigned project tasks. Local to this device. */
export interface Member {
  id: string;
  name: string;
  color: string;
  role?: string;
  createdAt: number;
  updatedAt: number;
}

/** Only finish-to-start in v1; the field leaves room for the other three. */
export type DependencyType = "FS";

/**
 * A precedence link between two project leaves. `lagDays` is counted in
 * working days after the predecessor finishes.
 */
export interface TaskDependency {
  id: string;
  workProjectId: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
}

export interface FocusSession {
  id: string;
  startedAt: number;
  endedAt?: number | null;
  plannedMin: number;
  taskId?: string | null;
  label?: string;
}

export interface Occurrence {
  /** stable key: item id for single items, `id@originalStart` for series instances */
  key: string;
  item: Item;
  start: number;
  end: number;
  /** the task time block this occurrence draws, when it is one */
  blockId?: string;
  /** the master's occurrence start, for exceptions */
  originalStart?: number;
  isRecurring: boolean;
  /** true when this is a task due marker rather than a time block */
  isDue?: boolean;
  /**
   * A generated holiday or observance. It has a synthetic item so the views
   * can draw it, but it is not user data and opens no editor.
   */
  holiday?: boolean;
  /**
   * Set when this came from a fixed weekly schedule rather than an item. The
   * occurrence may carry a one-off exception, while the timetable keeps its
   * recurring plan.
   */
  scheduleId?: string;
  /** The weekly session row this occurrence was generated from. */
  scheduleItemId?: string;
  /** The occurrence's original day start, before any one-off edit. */
  scheduleDay?: number;
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  0: "None",
  1: "Low",
  2: "Medium",
  3: "High",
};

export const PALETTE = [
  "#4f46e5",
  "#0d9488",
  "#e11d48",
  "#d97706",
  "#7c3aed",
  "#0284c7",
  "#65a30d",
  "#db2777",
  "#64748b",
] as const;

export const REMINDER_PRESETS = [
  { label: "At time", value: 0 },
  { label: "5 minutes before", value: 5 },
  { label: "15 minutes before", value: 15 },
  { label: "30 minutes before", value: 30 },
  { label: "1 hour before", value: 60 },
  { label: "1 day before", value: 1440 },
] as const;
