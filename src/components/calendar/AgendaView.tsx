import { useEffect, useMemo, useRef } from "react";
import { addDays, format, isToday } from "date-fns";
import { Bell, Check, MapPin, Repeat, Target } from "lucide-react";
import type { Goal, Item, Occurrence, Project } from "../../types";
import { eod, sod, timeLabel } from "../../lib/date";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { resolveColor } from "../../lib/draft";
import { isDone } from "../../lib/tasks";
import { repeatsBlocks } from "../../lib/timeblocks";
import {
  goalDateLabel,
  goalTimeLabel,
  isGoalDone,
  resolveGoalColor,
  spanShort,
} from "../../lib/goals";
import { openItemMenu } from "../../store/contextMenu";
import { isHighlightedOccurrence, type CollectionHighlight } from "../../lib/collectionFocus";
import { onCalendarScroll } from "../../lib/calendarScroll";

interface Props {
  /** 1 is the default row size; larger rows show less per screen. */
  zoom: number;
  from: number;
  days: number;
  occurrences: Occurrence[];
  projects: Project[];
  highlight?: CollectionHighlight | null;
  goals: Goal[];
  onOpen: (occ: Occurrence) => void;
  onOpenGoal: (goal: Goal) => void;
  onToggleTask: (item: Item) => void;
}

export function AgendaView({
  zoom,
  from,
  days,
  occurrences,
  projects,
  highlight,
  goals,
  onOpen,
  onOpenGoal,
  onToggleTask,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timeFormat = useTimeFormat();
  const scale = Math.min(1.5, Math.max(0.8, zoom));

  useEffect(
    () =>
      onCalendarScroll((dir, page) => {
        const el = scrollRef.current;
        if (!el) return;
        const step = (page ? el.clientHeight * 0.9 : 120) * (dir === "up" ? -1 : 1);
        el.scrollBy({ top: step, behavior: "smooth" });
      }),
    [],
  );

  const groups = useMemo(() => {
    const out: { key: number; date: Date; items: Occurrence[] }[] = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(new Date(from), i);
      const start = sod(date.getTime());
      const end = eod(start);
      const items = occurrences
        .filter(
          (o) =>
            (o.start < end && Math.max(o.end, o.start + 1) > start) ||
            (o.isDue && o.start >= start && o.start <= end),
        )
        .sort((a, b) => Number(a.isDue) - Number(b.isDue) || a.start - b.start);
      if (items.length > 0) out.push({ key: start, date, items });
    }
    return out;
  }, [from, days, occurrences]);

  // Goals outlive any single day, so they get one block above the day list.
  const activeGoals = useMemo(
    () =>
      goals
        .filter((g) => !isGoalDone(g))
        .filter((g) => sod(g.start) <= eod(addDays(new Date(from), days - 1).getTime()))
        .sort((a, b) => a.start - b.start),
    [goals, from, days],
  );

  if (groups.length === 0 && activeGoals.length === 0) {
    return (
      <div className="agenda" ref={scrollRef} style={{ ["--az" as string]: scale }}>
        <div className="empty agenda-empty">
          <strong>Nothing on the agenda</strong>
          Drag on the week grid or press N to add something.
        </div>
      </div>
    );
  }

  return (
    <div className="agenda" ref={scrollRef} style={{ ["--az" as string]: scale }}>
      {activeGoals.length > 0 && (
        <div className="agenda-goals">
          <div className="agenda-date">
            Goals
            <span className="today-pill">{activeGoals.length}</span>
          </div>
          {activeGoals.map((goal) => {
            const color = resolveGoalColor(goal, projects);
            const project = projects.find((p) => p.id === goal.projectId);
            return (
              <div
                key={goal.id}
                className="agenda-row"
                data-goal="true"
                style={{ ["--ev-color" as string]: color }}
                onClick={() => onOpenGoal(goal)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpenGoal(goal);
                }}
              >
                <div className="agenda-time">{spanShort(goal.span)}</div>
                <div className="agenda-bar" />
                <div className="agenda-main">
                  <div className="row" style={{ gap: 6 }}>
                    <Target size={11} style={{ color, flex: "none" }} />
                    <span className="agenda-title">{goal.title || "Untitled goal"}</span>
                  </div>
                  <div className="agenda-meta">
                    <span>{goalDateLabel(goal)}</span>
                    <span>{goalTimeLabel(goal)}</span>
                    {project && <span>{project.name}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {groups.map((group) => (
        <div key={group.key}>
          <div className="agenda-date">
            {format(group.date, "EEEE, MMMM d")}
            {isToday(group.date) && <span className="today-pill">TODAY</span>}
          </div>
          {group.items.map((occ) => {
            const item = occ.item;
            const color = resolveColor(item, projects);
            const done = isDone(item);
            return (
              <div
                key={occ.key}
                className="agenda-row"
                data-done={done}
                data-schedule={occ.scheduleId ? "true" : undefined}
                data-highlight={isHighlightedOccurrence(occ, highlight) || undefined}
                onClick={() => onOpen(occ)}
                onContextMenu={(e) => openItemMenu(e, item, occ)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpen(occ);
                }}
              >
                <div className="agenda-time">
                  {occ.isDue
                    ? "due"
                    : item.allDay
                      ? "all-day"
                      : timeLabel(occ.start, false, timeFormat)}
                </div>
                <div className="agenda-bar" style={{ ["--ev-color" as string]: color }} />
                <div className="agenda-main">
                  <div className="row" style={{ gap: 6 }}>
                    {item.type === "task" && (
                      <button
                        className="check"
                        data-checked={done}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleTask(item);
                        }}
                        style={{ width: 13, height: 13 }}
                        title={done ? "Mark not done" : "Mark done"}
                      >
                        <Check size={9} strokeWidth={3} />
                      </button>
                    )}
                    <span className="agenda-title">{item.title || "Untitled"}</span>
                  </div>
                  <div className="agenda-meta">
                    {item.allDay && !occ.isDue && item.type === "event" && <span>All day</span>}
                    {item.location && (
                      <span className="row" style={{ gap: 3 }}>
                        <MapPin size={9} /> {item.location}
                      </span>
                    )}
                    {item.type === "task" && item.estimateMin ? <span>{item.estimateMin}m est.</span> : null}
                    {(item.recurrence || repeatsBlocks(item)) && (
                      <span className="row" style={{ gap: 3 }}>
                        <Repeat size={9} /> repeats
                      </span>
                    )}
                    {item.reminders && item.reminders.length > 0 && (
                      <span className="row" style={{ gap: 3 }}>
                        <Bell size={9} /> {item.reminders.length}
                      </span>
                    )}
                  </div>
                </div>
                {occ.isDue && <span className="chip">task</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
