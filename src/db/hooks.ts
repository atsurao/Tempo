import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "./db";
import type {
  FocusSession,
  Goal,
  Habit,
  HabitCheckin,
  Item,
  Member,
  Project,
  Schedule,
  ScheduleBreak,
  ScheduleException,
  ScheduleItem,
  Tag,
  TaskDependency,
  WorkProject,
} from "../types";

export function useItems(): Item[] {
  return useLiveQuery(() => db.items.toArray(), []) ?? [];
}

export function useProjects(): Project[] {
  return useLiveQuery(() => db.projects.orderBy("order").toArray(), []) ?? [];
}

export function useTags(): Tag[] {
  return useLiveQuery(() => db.tags.orderBy("name").toArray(), []) ?? [];
}

export function useGoals(): Goal[] {
  return useLiveQuery(() => db.goals.toArray(), []) ?? [];
}

export function useSchedules(): Schedule[] {
  return useLiveQuery(() => db.schedules.orderBy("order").toArray(), []) ?? [];
}

export function useScheduleItems(): ScheduleItem[] {
  return useLiveQuery(() => db.scheduleItems.toArray(), []) ?? [];
}

export function useScheduleBreaks(): ScheduleBreak[] {
  return useLiveQuery(() => db.scheduleBreaks.toArray(), []) ?? [];
}

export function useScheduleExceptions(): ScheduleException[] {
  return useLiveQuery(() => db.scheduleExceptions.toArray(), []) ?? [];
}

export function useHabits(): Habit[] {
  return useLiveQuery(() => db.habits.orderBy("order").toArray(), []) ?? [];
}

export function useHabitCheckins(): HabitCheckin[] {
  return useLiveQuery(() => db.habitCheckins.toArray(), []) ?? [];
}

export function useWorkProjects(): WorkProject[] {
  return useLiveQuery(() => db.workProjects.orderBy("order").toArray(), []) ?? [];
}

export function useMembers(): Member[] {
  return useLiveQuery(() => db.members.orderBy("name").toArray(), []) ?? [];
}

export function useTaskDependencies(): TaskDependency[] {
  return useLiveQuery(() => db.taskDependencies.toArray(), []) ?? [];
}

/**
 * The whole timetable in one object, so a view builds one occurrence list
 * rather than reaching for three tables.
 */
export function useTimetable(): {
  schedules: Schedule[];
  items: ScheduleItem[];
  breaks: ScheduleBreak[];
  exceptions: ScheduleException[];
} {
  const schedules = useSchedules();
  const items = useScheduleItems();
  const breaks = useScheduleBreaks();
  const exceptions = useScheduleExceptions();
  return { schedules, items, breaks, exceptions };
}

export function useFocusSessions(): FocusSession[] {
  return useLiveQuery(() => db.focusSessions.orderBy("startedAt").reverse().toArray(), []) ?? [];
}

/** Re-render on an interval; used for clocks, countdowns and reminders. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
