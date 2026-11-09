import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  Flame,
  ListTodo,
  MapPin,
  Timer,
  TimerOff,
} from "lucide-react";
import {
  useHabitCheckins,
  useHabits,
  useItems,
  useProjects,
  useNow,
  useTimetable,
} from "../../db/hooks";
import { useUI } from "../../store/ui";
import { useOpenView } from "../../store/nav";
import { buildOccurrences } from "../../lib/occurrences";
import { buildScheduleOccurrences, visibleSchedules } from "../../lib/schedule";
import { hiddenCalendarIds, hiddenTaskInfo, taskViewRows } from "../../lib/calendars";
import type { Item, Occurrence } from "../../types";
import { durationLabel, eod, relativeLabel, sod, timeLabel } from "../../lib/date";
import { clockTime } from "../../lib/clock";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { resolveColor, draftFromItem } from "../../lib/draft";
import { isDone, rootTasks } from "../../lib/tasks";
import { toggleHabitDone, toggleTaskComplete } from "../../db/db";
import {
  doneDays,
  habitStreak,
  habitSummary,
  habitsDueOn,
  isHabitDone,
} from "../../lib/habits";
import { QuickAddBar } from "../tasks/QuickAddBar";
import { openItemMenu, openPostponeMenu } from "../../store/contextMenu";
import { HiddenTasksNote } from "../tasks/HiddenTasksNote";

export function TodayPane() {
  const items = useItems();
  const projects = useProjects();
  const openEdit = useUI((s) => s.openEdit);
  const openCreate = useUI((s) => s.openCreate);
  const openView = useOpenView();
  const toast = useUI((s) => s.toast);
  const keepOverdue = useUI((s) => s.keepOverdue);
  const habits = useHabits();
  const habitCheckins = useHabitCheckins();
  const now = useNow(30_000);
  const timeFormat = useTimeFormat();
  const [completing, setCompleting] = useState<Set<string>>(() => new Set());
  const completionTimers = useRef(new Map<string, number>());
  const pendingCompletions = useRef(new Set<string>());
  const toggleRef = useRef<(id: string) => Promise<void>>(async () => {});

  useEffect(
    () => () => {
      for (const [id, timer] of completionTimers.current) {
        window.clearTimeout(timer);
        // Leaving Today during the exit animation must still complete the
        // task; clearing the timer alone would silently discard the action.
        if (pendingCompletions.current.has(id)) void toggleRef.current(id);
      }
      completionTimers.current.clear();
      pendingCompletions.current.clear();
    },
    [],
  );

  const dayStart = sod(now);
  const dayEnd = eod(dayStart);
  // Hiding a calendar quiets it here as well: its events and tasks leave the
  // timeline, the due list and the focus queue. Timetable sessions belong to a
  // schedule rather than a calendar, so they stay.
  const hiddenCalendars = useMemo(() => hiddenCalendarIds(projects), [projects]);
  const visibleItems = useMemo(
    () => taskViewRows(items, hiddenCalendars, null, { keepOverdue }),
    [items, hiddenCalendars, keepOverdue],
  );
  const hiddenInfo = useMemo(
    () => hiddenTaskInfo(items, projects, { keepOverdue }),
    [items, projects, keepOverdue],
  );
  const timetable = useTimetable();
  const {
    schedules: scheduleRows,
    items: scheduleItems,
    breaks: scheduleBreaks,
    exceptions: scheduleExceptions,
  } = timetable;
  const shownSchedules = useMemo(() => visibleSchedules(scheduleRows), [scheduleRows]);
  const occs = useMemo(
    () =>
      [
        ...buildOccurrences(visibleItems, dayStart, dayEnd),
        ...buildScheduleOccurrences(
          {
            schedules: shownSchedules,
            items: scheduleItems,
            breaks: scheduleBreaks,
            exceptions: scheduleExceptions,
          },
          dayStart,
          dayEnd,
        ),
      ].sort((a, b) => a.start - b.start),
    [visibleItems, dayStart, shownSchedules, scheduleItems, scheduleBreaks, scheduleExceptions],
  );

  /** A timetable session has no editor of its own: it opens its schedule. */
  const openOccurrence = (occ: Occurrence) => {
    if (occ.scheduleId) {
      useUI.getState().setScheduleEditor(occ.scheduleId);
      return;
    }
    openEdit(occ.item.id, draftFromItem(occ.item, occ), occ.originalStart);
  };  const timeline = occs
    .filter((o) => !o.isDue && !(o.item.type === "task" && isDone(o.item)))
    .sort((a, b) => a.start - b.start);
  const next = timeline.find((o) => o.start > now) ?? null;

  const dueToday = visibleItems.filter(
    (i) =>
      i.type === "task" &&
      !i.deletedAt &&
      !isDone(i) &&
      i.dueAt != null &&
      i.dueAt >= dayStart &&
      i.dueAt <= dayEnd,
  );
  const overdue = visibleItems.filter(
    (i) => i.type === "task" && !i.deletedAt && !isDone(i) && i.dueAt != null && i.dueAt < dayStart,
  );
  const queue = rootTasks(visibleItems)
    .filter((t) => !isDone(t) && t.start == null && !dueToday.some((d) => d.id === t.id))
    .slice(0, 4);

  // Habits that run today, answered with the same helper the habits pane and
  // the rail badge use, so all three can never disagree about what is done.
  const habitDone = useMemo(() => doneDays(habitCheckins), [habitCheckins]);
  const habitsToday = useMemo(
    () => habitsDueOn(habits.filter((habit) => !habit.archivedAt), dayStart),
    [habits, dayStart],
  );
  const habitsLeft = habitsToday.filter(
    (habit) => !isHabitDone(habitDone, habit.id, dayStart),
  ).length;

  const scheduledMin = timeline.reduce((sum, o) => sum + Math.max(0, o.end - o.start), 0) / 60_000;
  const greeting = new Date(now).getHours() < 12 ? "Good morning" : new Date(now).getHours() < 18 ? "Good afternoon" : "Good evening";

  const toggle = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const result = await toggleTaskComplete(item);
    if (result.nextDue) {
      toast(
        `Next: ${new Date(result.nextDue).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      );
    }
  };
  toggleRef.current = toggle;

  /** Let a task row visibly leave before completing it and dropping it. */
  const toggleWithMotion = (task: Item) => {
    if (isDone(task)) {
      void toggle(task.id);
      return;
    }
    if (completing.has(task.id) || completionTimers.current.has(task.id)) return;
    setCompleting((current) => new Set(current).add(task.id));
    pendingCompletions.current.add(task.id);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(
      () => {
        completionTimers.current.delete(task.id);
        pendingCompletions.current.delete(task.id);
        setCompleting((current) => {
          const next = new Set(current);
          next.delete(task.id);
          return next;
        });
        void toggle(task.id);
      },
      reduced ? 0 : 210,
    );
    completionTimers.current.set(task.id, timer);
  };

  return (
    <div className="today">
      <div className="today-head">
        <div style={{ flex: 1 }}>
          <div className="today-h1">{greeting}.</div>
          <div className="today-sub">
            {format(now, "EEEE, MMMM d")} · {timeline.length} on the calendar
          </div>
        </div>
        <button
          className="icon-btn"
          title="New event"
          onClick={() => {
            const start = dayStart + 9 * 3_600_000;
            openCreate({ type: "event", start, end: start + 3_600_000, title: "" });
          }}
        >
          <CalendarDays size={15} />
        </button>
      </div>

      <div className="today-stats">
        <span className="stat-pill">
          <Clock size={10} /> {durationLabel(scheduledMin)} scheduled
        </span>
        <span className="stat-pill">
          <ListTodo size={10} /> {dueToday.length} due
        </span>
        {overdue.length > 0 && (
          <button className="stat-pill" style={{ color: "#e5484d" }} onClick={() => openView("tasks")}>
            <TimerOff size={10} /> {overdue.length} overdue
          </button>
        )}
      </div>

      <HiddenTasksNote count={hiddenInfo.count} calendars={hiddenInfo.calendars} />

      {next && (
        <div
          className="next-card"
          style={{ marginTop: 12 }}
          onContextMenu={(e) => openItemMenu(e, next.item, next)}
        >
          <div className="next-accent" style={{ ["--ev-color" as string]: resolveColor(next.item, projects) }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="next-label">Next up</div>
            <div className="next-title">{next.item.title || "Untitled"}</div>
            <div className="next-meta">
              <span>
                {timeLabel(next.start, false, timeFormat)} – {timeLabel(next.end, false, timeFormat)}
              </span>
              {next.item.location && (
                <span className="row" style={{ gap: 3 }}>
                  <MapPin size={9} /> {next.item.location}
                </span>
              )}
              <span className="countdown">{relativeLabel(next.start, now)}</span>
            </div>
          </div>
          <button className="icon-btn" title="Open" onClick={() => openOccurrence(next)}>
            <ArrowRight size={14} />
          </button>
        </div>
      )}

      {habitsToday.length > 0 && (
        <section
          className="today-habits"
          data-complete={habitsLeft === 0}
          aria-label="Habits today"
        >
          <div className="today-habits-head">
            <Flame size={12} />
            <span>Habits</span>
            <span className="today-habits-count">
              {habitsToday.length - habitsLeft}/{habitsToday.length} today
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn subtle sm" onClick={() => openView("habits")}>
              all habits
            </button>
          </div>
          <div className="today-habits-row">
            {habitsToday.map((habit) => {
              const done = isHabitDone(habitDone, habit.id, dayStart);
              const streak = habitStreak(habit, habitDone, now);
              return (
                <button
                  key={habit.id}
                  className="today-habit"
                  data-done={done}
                  aria-pressed={done}
                  title={
                    done
                      ? `${habit.name} · done today. Click to undo.`
                      : `${habit.name} · ${habitSummary(habit)}${
                          streak > 1 ? ` · ${streak} in a row` : ""
                        }`
                  }
                  onClick={() => void toggleHabitDone(habit, dayStart)}
                >
                  <span className="check" data-checked={done}>
                    <Check size={9} strokeWidth={3} />
                  </span>
                  <span className="today-habit-dot" style={{ background: habit.color }} />
                  <span className="today-habit-name">{habit.name}</span>
                  {streak > 1 && (
                    <span className="today-habit-streak">
                      <Flame size={9} /> {streak}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <QuickAddBar placeholder="Capture something…  problem set fri 5pm #school" showPreview />

      <div className="section-title">
        <Clock size={11} /> Today
        <span className="count">{timeline.length}</span>
        <span style={{ flex: 1 }} />
        <button className="btn subtle sm" onClick={() => openView("calendar")}>
          open calendar
        </button>
      </div>

      {timeline.length === 0 && <div className="today-empty">Nothing scheduled. A clear day.</div>}

      {timeline.map((occ) => {
        const done = isDone(occ.item);
        return (
          <div
            key={occ.key}
            className="today-row"
            data-done={done}
            data-completing={completing.has(occ.item.id) || undefined}
            data-schedule={occ.scheduleId ? "true" : undefined}
            data-now={occ.start <= now && occ.end >= now}
            onClick={() => openOccurrence(occ)}
            onContextMenu={(e) => openItemMenu(e, occ.item, occ)}
          >
            <span className="today-time">
              {occ.item.allDay ? "all-day" : timeLabel(occ.start, false, timeFormat)}
            </span>
            <span className="today-bar" style={{ ["--ev-color" as string]: resolveColor(occ.item, projects) }} />
            <span className="today-title">{occ.item.title || "Untitled"}</span>
            {occ.item.type === "task" && (
              <button
                className="check"
                data-checked={done}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleWithMotion(occ.item);
                }}
              >
                <Check size={9} strokeWidth={3} />
              </button>
            )}
            {occ.item.estimateMin && occ.item.type === "task" && (
              <span className="today-meta">{occ.item.estimateMin}m</span>
            )}
          </div>
        );
      })}

      {dueToday.length > 0 && (
        <>
          <div className="section-title">
            <ListTodo size={11} /> Due today
            <span className="count">{dueToday.length}</span>
          </div>
          {dueToday.map((task) => (
            <div
              key={task.id}
              className="today-row"
              data-completing={completing.has(task.id) || undefined}
              onClick={() => openEdit(task.id, draftFromItem(task))}
              onContextMenu={(e) => openItemMenu(e, task)}
            >
              <span className="today-time">
                {task.dueAt && !task.dueAllDay && new Date(task.dueAt).getHours() !== 23
                  ? clockTime(task.dueAt, timeFormat)
                  : "due"}
              </span>
              <span
                className="today-bar"
                style={{ ["--ev-color" as string]: resolveColor(task, projects) }}
              />
              <span className="today-title">{task.title}</span>
              <button
                className="check"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleWithMotion(task);
                }}
              >
                <Check size={9} strokeWidth={3} />
              </button>
            </div>
          ))}
        </>
      )}

      {overdue.length > 0 && (
        <>
          <div className="section-title" style={{ color: "#e5484d" }}>
            <TimerOff size={11} /> Overdue
            <span className="count">{overdue.length}</span>
          </div>
          {overdue.slice(0, 5).map((task) => (
            <div
              key={task.id}
              className="today-row"
              data-completing={completing.has(task.id) || undefined}
              onClick={() => openEdit(task.id, draftFromItem(task))}
              onContextMenu={(e) => openItemMenu(e, task)}
            >
              <span className="today-time" style={{ color: "#e5484d" }}>
                {format(task.dueAt!, "MMM d")}
              </span>
              <span className="today-bar" style={{ ["--ev-color" as string]: "#e5484d" }} />
              <span className="today-title">{task.title}</span>
              <button
                className="postpone-btn"
                title="Change this task's due date"
                onClick={(e) => openPostponeMenu(e, task.id)}
              >
                Postpone
              </button>
              <button
                className="check"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleWithMotion(task);
                }}
              >
                <Check size={9} strokeWidth={3} />
              </button>
            </div>
          ))}
        </>
      )}

      {queue.length > 0 && (
        <>
          <div className="section-title">
            <Timer size={11} /> Focus queue
            <span className="count">unscheduled</span>
          </div>
          {queue.map((task) => (
            <div
              key={task.id}
              className="today-row"
              onClick={() => openEdit(task.id, draftFromItem(task))}
              onContextMenu={(e) => openItemMenu(e, task)}
            >
              <span className="today-time">{task.estimateMin ? `${task.estimateMin}m` : "—"}</span>
              <span
                className="today-bar"
                style={{ ["--ev-color" as string]: resolveColor(task, projects) }}
              />
              <span className="today-title">{task.title}</span>
              {task.priority ? <span className="today-meta">P{task.priority}</span> : null}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
