import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  ListTodo,
  Sparkles,
  Sun,
} from "lucide-react";
import type { Item, Occurrence } from "../../types";
import { useItems, useProjects } from "../../db/hooks";
import { toggleTaskComplete } from "../../db/db";
import { useUI } from "../../store/ui";
import { eod, sod } from "../../lib/date";
import { buildOccurrences } from "../../lib/occurrences";
import { isDone, isOverdue } from "../../lib/tasks";
import { draftFromItem } from "../../lib/draft";
import { clockTime } from "../../lib/clock";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { holidayLabelOn } from "../../lib/holidays";

type WidgetId = "today" | "tasks" | "calendar" | "big" | "next";

const WIDGETS: { id: WidgetId; label: string }[] = [
  { id: "today", label: "Today at a glance" },
  { id: "tasks", label: "Today's tasks" },
  { id: "calendar", label: "Today's calendar" },
  { id: "big", label: "Full day" },
  { id: "next", label: "Next up" },
];

/**
 * A gallery of glanceable cards, built from the same data as Today. Each card
 * is a small, self-contained read model, and the picker chooses which ones are
 * on the board.
 */
export function WidgetsPane() {
  const items = useItems();
  const projects = useProjects();
  const openEdit = useUI((s) => s.openEdit);
  const toast = useUI((s) => s.toast);
  const timeFormat = useTimeFormat();
  const [visible, setVisible] = useState<WidgetId[]>(WIDGETS.map((widget) => widget.id));

  const now = Date.now();
  const dayStart = sod(now);
  const dayEnd = eod(dayStart);

  const live = useMemo(() => items.filter((item) => !item.deletedAt), [items]);

  const todayTasks = useMemo(
    () =>
      live
        .filter(
          (item) =>
            item.type === "task" &&
            item.dueAt != null &&
            item.dueAt <= dayEnd &&
            !isDone(item),
        )
        .sort(
          (a, b) =>
            (b.priority ?? 0) - (a.priority ?? 0) ||
            (a.dueAt ?? 0) - (b.dueAt ?? 0),
        ),
    [live, dayEnd],
  );

  const todayEvents = useMemo(() => {
    const occurrences = buildOccurrences(live, dayStart, dayEnd);
    return occurrences
      .filter((occ) => !occ.isDue && occ.start <= dayEnd && occ.end > dayStart)
      .sort((a, b) => a.start - b.start);
  }, [live, dayStart, dayEnd]);

  const nextUp = useMemo(() => {
    const events = buildOccurrences(live, now, now + 7 * 86_400_000);
    const candidates = [
      ...events
        .filter((occ) => !occ.isDue && occ.start >= now)
        .map((occ) => ({ start: occ.start, title: occ.item.title, kind: "event" as const, occ })),
      ...live
        .filter(
          (item) =>
            item.type === "task" &&
            item.dueAt != null &&
            item.dueAt >= now &&
            !isDone(item),
        )
        .map((item) => ({
          start: item.dueAt as number,
          title: item.title,
          kind: "task" as const,
          occ: null as Occurrence | null,
        })),
    ].sort((a, b) => a.start - b.start);
    return candidates[0] ?? null;
  }, [live, now]);

  const toggle = async (item: Item) => {
    const result = await toggleTaskComplete(item);
    if (result.nextDue) {
      toast(
        `Repeats — next due ${new Date(result.nextDue).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}`,
      );
    }
  };

  const openItem = (item: Item) => openEdit(item.id, draftFromItem(item));
  const openOccurrence = (occ: Occurrence) => {
    if (occ.holiday) {
      toast(occ.item.title);
      return;
    }
    openEdit(occ.item.id, draftFromItem(occ.item, occ), occ.originalStart);
  };

  const todayLabel = useMemo(() => holidayLabelOn(dayStart), [dayStart]);

  const widgets = {
    today: (
      <article className="widget-card" data-size="wide" key="today">
        <div className="widget-card-head">
          <Sun size={11} /> Today
        </div>
        <div className="widget-big">
          <div>
            <h2>
              {format(now, "EEEE, MMMM d")}
              {todayLabel ? ` · ${todayLabel}` : ""}
            </h2>
            <p className="faint">
              {todayTasks.length} to do · {todayEvents.length} on the calendar
            </p>
          </div>
          {[...todayEvents.slice(0, 3)].map((occ) => (
            <button className="widget-row" key={occ.key} onClick={() => openOccurrence(occ)}>
              <span className="widget-dot" style={{ background: occ.item.color ?? "var(--accent)" }} />
              <span className="widget-time">
                {occ.item.allDay ? "All day" : clockTime(occ.start, timeFormat)}
              </span>
              <span className="widget-title">{occ.item.title || "Untitled"}</span>
            </button>
          ))}
          {todayTasks.slice(0, 3).map((task) => (
            <button className="widget-row" key={task.id} onClick={() => openItem(task)}>
              <span className="widget-check" />
              <span className="widget-title">{task.title || "Untitled"}</span>
            </button>
          ))}
          {todayTasks.length === 0 && todayEvents.length === 0 && (
            <div className="widget-empty">Nothing scheduled. A clear day.</div>
          )}
        </div>
      </article>
    ),
    tasks: (
      <article className="widget-card" key="tasks">
        <div className="widget-card-head">
          <ListTodo size={11} /> Today's tasks
        </div>
        {todayTasks.length === 0 ? (
          <div className="widget-empty">No tasks due today.</div>
        ) : (
          todayTasks.slice(0, 6).map((task) => (
            <button className="widget-row" key={task.id} onClick={() => openItem(task)}>
              <span
                className="widget-check"
                role="checkbox"
                aria-checked={false}
                onClick={(event) => {
                  event.stopPropagation();
                  void toggle(task);
                }}
              >
                <Check size={9} />
              </span>
              <span className="widget-title" data-overdue={isOverdue(task) || undefined}>
                {task.title || "Untitled"}
              </span>
              {task.priority ? <span className="faint">!</span> : null}
            </button>
          ))
        )}
        {todayTasks.length > 6 && (
          <div className="faint">+{todayTasks.length - 6} more</div>
        )}
      </article>
    ),
    calendar: (
      <article className="widget-card" key="calendar">
        <div className="widget-card-head">
          <CalendarDays size={11} /> Today's calendar
        </div>
        {todayEvents.length === 0 ? (
          <div className="widget-empty">Nothing on the calendar.</div>
        ) : (
          todayEvents.slice(0, 6).map((occ) => (
            <button className="widget-row" key={occ.key} onClick={() => openOccurrence(occ)}>
              <span className="widget-dot" style={{ background: occ.item.color ?? "var(--accent)" }} />
              <span className="widget-time">
                {occ.item.allDay ? "All day" : clockTime(occ.start, timeFormat)}
              </span>
              <span className="widget-title">{occ.item.title || "Untitled"}</span>
            </button>
          ))
        )}
      </article>
    ),
    big: (
      <article className="widget-card" data-size="wide" key="big">
        <div className="widget-card-head">
          <Sparkles size={11} /> The whole day
        </div>
        {nextUp && (
          <div className="widget-next">
            <span className="widget-next-time">
              Next up · {format(nextUp.start, "EEE")} {clockTime(nextUp.start, timeFormat)}
            </span>
            <span className="widget-next-title">{nextUp.title || "Untitled"}</span>
            <span className="widget-next-sub">
              {nextUp.kind === "event" ? "On the calendar" : "Task due"}
            </span>
          </div>
        )}
        <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="widget-card-head" style={{ marginBottom: 6 }}>
              Events
            </div>
            {todayEvents.length === 0 ? (
              <div className="widget-empty">None</div>
            ) : (
              todayEvents.slice(0, 4).map((occ) => (
                <button className="widget-row" key={occ.key} onClick={() => openOccurrence(occ)}>
                  <span className="widget-time">
                    {occ.item.allDay ? "All day" : clockTime(occ.start, timeFormat)}
                  </span>
                  <span className="widget-title">{occ.item.title || "Untitled"}</span>
                </button>
              ))
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="widget-card-head" style={{ marginBottom: 6 }}>
              Tasks
            </div>
            {todayTasks.length === 0 ? (
              <div className="widget-empty">None</div>
            ) : (
              todayTasks.slice(0, 4).map((task) => (
                <button className="widget-row" key={task.id} onClick={() => openItem(task)}>
                  <span className="widget-check" onClick={(event) => { event.stopPropagation(); void toggle(task); }}>
                    <Check size={9} />
                  </span>
                  <span className="widget-title">{task.title || "Untitled"}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </article>
    ),
    next: (
      <article className="widget-card" key="next">
        <div className="widget-card-head">
          <ArrowRight size={11} /> Next up
        </div>
        {nextUp ? (
          <div className="widget-next">
            <span className="widget-next-time">
              {format(nextUp.start, "EEEE, MMM d")} · {clockTime(nextUp.start, timeFormat)}
            </span>
            <span className="widget-next-title">{nextUp.title || "Untitled"}</span>
            <span className="widget-next-sub">
              {nextUp.kind === "event"
                ? `${projects.find((p) => p.id === nextUp.occ?.item.projectId)?.name ?? "Calendar"}`
                : "Task due"}
            </span>
          </div>
        ) : (
          <div className="widget-empty">Nothing ahead in the next week.</div>
        )}
      </article>
    ),
  };

  return (
    <div className="widgets">
      <div className="widgets-head">
        <h1>Widgets</h1>
        <p>Pick the glances you want on this board.</p>
        <span className="spacer" />
        <ChevronRight size={13} className="faint" />
      </div>
      <div className="widgets-picker">
        {WIDGETS.map((widget) => {
          const on = visible.includes(widget.id);
          return (
            <button
              key={widget.id}
              className="filter-chip"
              data-active={on}
              aria-pressed={on}
              onClick={() =>
                setVisible((current) =>
                  on ? current.filter((id) => id !== widget.id) : [...current, widget.id],
                )
              }
            >
              {widget.label}
            </button>
          );
        })}
      </div>
      <div className="widgets-grid">
        {WIDGETS.filter((widget) => visible.includes(widget.id)).map(
          (widget) => widgets[widget.id],
        )}
      </div>
    </div>
  );
}
