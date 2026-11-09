import { useEffect, useMemo, useState } from "react";
import { Timer } from "lucide-react";
import { useItems, useProjects, useTimetable } from "../../db/hooks";
import { useOpenView } from "../../store/nav";
import { useUI } from "../../store/ui";
import { buildOccurrences } from "../../lib/occurrences";
import { buildScheduleOccurrences, visibleSchedules } from "../../lib/schedule";
import { durationLabel, eod, relativeLabel, sod } from "../../lib/date";
import { clockTime } from "../../lib/clock";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { isDone } from "../../lib/tasks";
import { hiddenCalendarIds, taskViewRows } from "../../lib/calendars";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function StatusBar() {
  const items = useItems();
  const projects = useProjects();
  const keepOverdue = useUI((s) => s.keepOverdue);
  const timer = useUI((s) => s.timer);
  const timeFormat = useTimeFormat();
  const openView = useOpenView();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // The bar reports what the views show, so a hidden calendar's next event is
  // not promised in the corner while its Today pane is empty.
  const hiddenCalendars = useMemo(() => hiddenCalendarIds(projects), [projects]);
  const visibleItems = useMemo(
    () => taskViewRows(items, hiddenCalendars, null, { keepOverdue }),
    [items, hiddenCalendars, keepOverdue],
  );

  const dayStart = sod(now);
  const dayEnd = eod(dayStart);
  const timetable = useTimetable();
  const { schedules, items: scheduleItems, breaks, exceptions } = timetable;
  const shownSchedules = useMemo(() => visibleSchedules(schedules), [schedules]);
  const occs = useMemo(
    () =>
      [
        ...buildOccurrences(visibleItems, dayStart, dayEnd),
        ...buildScheduleOccurrences(
          { schedules: shownSchedules, items: scheduleItems, breaks, exceptions },
          dayStart,
          dayEnd,
        ),
      ].sort((a, b) => a.start - b.start),
    [visibleItems, dayStart, dayEnd, shownSchedules, scheduleItems, breaks, exceptions],
  );

  const next = occs.find((o) => !o.isDue && o.start > now);
  const eventCount = occs.filter((o) => o.item.type === "event").length;
  const openTasks = visibleItems.filter((i) => i.type === "task" && !i.deletedAt && !isDone(i)).length;
  const overdue = visibleItems.filter(
    (i) => i.type === "task" && !i.deletedAt && !isDone(i) && i.dueAt != null && i.dueAt < now,
  ).length;

  const remaining = timer.running && timer.endsAt ? Math.max(0, Math.round((timer.endsAt - now) / 1000)) : timer.remainingSec;

  return (
    <footer className="statusbar">
      <span>
        {new Date(now).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        })}
      </span>
      <span className="dot" />
      <span>{eventCount} events</span>
      <span className="dot" />
      <span>{openTasks} open</span>
      {overdue > 0 && (
        <>
          <span className="dot" />
          <button className="status-chip" onClick={() => openView("tasks")} style={{ color: "#e5484d" }}>
            {overdue} overdue
          </button>
        </>
      )}

      <div className="spacer" />

      {next && (
        <span className="row" style={{ gap: 6, minWidth: 0 }}>
          <span className="faint">Next</span>
          <span className="truncate" style={{ color: "var(--text-2)", maxWidth: 260 }}>
            {next.item.title}
          </span>
          <span className="faint">{relativeLabel(next.start, now)}</span>
          <span className="dot" />
        </span>
      )}

      {(timer.running || remaining !== timer.totalSec) && (
        <button
          className="status-chip live"
          onClick={() => openView("focus")}
          title="Open focus timer"
        >
          <Timer size={11} />
          {pad(Math.floor(remaining / 60))}:{pad(remaining % 60)}
          <span style={{ opacity: 0.65 }}>{durationLabel(timer.totalSec / 60)}</span>
        </button>
      )}

      <span className="tabular" style={{ color: "var(--text-2)" }}>
        {clockTime(now, timeFormat)}
      </span>
    </footer>
  );
}
