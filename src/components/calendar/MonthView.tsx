import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, format, startOfMonth, startOfWeek } from "date-fns";
import { Flag, Plus, Target } from "lucide-react";
import type { Goal, Occurrence, Project } from "../../types";
import type { EditorDraft } from "../../store/ui";
import { useUI } from "../../store/ui";
import { DND_TYPE, resolveColor } from "../../lib/draft";
import { sod } from "../../lib/date";
import { isDone } from "../../lib/tasks";
import { goalDeadlineKey, resolveGoalColor } from "../../lib/goals";
import { openItemMenu, openSlotMenu } from "../../store/contextMenu";
import { clockShort } from "../../lib/clock";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { isHighlightedOccurrence, type CollectionHighlight } from "../../lib/collectionFocus";
import { onCalendarScroll } from "../../lib/calendarScroll";
import { glideDuration, glideTop } from "../../lib/glide";
import { useIsMobile } from "../../hooks/useIsMobile";

const MAX_CHIPS = 4;
/** A week row at zoom 1; the whole grid scales from here. */
const BASE_ROW = 124;

interface Props {
  anchorDate: number;
  /** Month starts rendered top to bottom, oldest first. */
  months: Date[];
  /** 1 is the default month size; larger rows show less, smaller rows more. */
  zoom: number;
  /** called near either end of the loaded stack, in the direction of travel */
  onNeedMore: (dir: -1 | 1) => void;
  weekStart: 0 | 1;
  occurrences: Occurrence[];
  projects: Project[];
  /** Items from a just-chosen calendar or schedule. */
  highlight?: CollectionHighlight | null;
  /** long-term goals, marked only on the day their deadline falls */
  goals: Goal[];
  onOpen: (occ: Occurrence) => void;
  onOpenGoal: (goal: Goal) => void;
  onCreate: (draft: EditorDraft) => void;
  onScheduleTask: (itemId: string, start: number) => void;
  onSelectDay: (ts: number) => void;
  onSelectMonth: (ts: number) => void;
}

interface Week {
  key: number;
  days: Date[];
}

/**
 * The month view is a continuous calendar, not a stack of month cards. Weeks
 * run from the first loaded month straight into the last with no repeat at a
 * boundary, and the month name floats above the grid, changing as the reader
 * scrolls instead of restarting the weeks underneath it.
 */
export function MonthView({
  anchorDate,
  months,
  zoom,
  onNeedMore,
  weekStart,
  occurrences,
  projects,
  highlight,
  goals,
  onOpen,
  onOpenGoal,
  onCreate,
  onScheduleTask,
  onSelectDay,
  onSelectMonth,
}: Props) {
  const mobile = useIsMobile();
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [labelMonth, setLabelMonth] = useState(() => startOfMonth(anchorDate).getTime());
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Last anchor month this stack has already brought to the top. */
  const positionedRef = useRef<number | null>(null);
  const extendLockRef = useRef<"start" | "end" | null>(null);
  const settleRef = useRef<number | null>(null);
  /** The settle glide in flight: its animation frame and its safety timer. */
  const glideRef = useRef<{ frame: number; guard: number } | null>(null);
  const firstWeekRef = useRef<number | null>(null);
  const prevScrollHeightRef = useRef(0);
  const prevRowHeightRef = useRef<number | null>(null);
  const lastTodayPulse = useRef(useUI.getState().todayPulse);

  const rowHeight = Math.max(64, Math.round(BASE_ROW * zoom));
  const weekHeight = rowHeight + 1;
  const anchorMonthKey = useMemo(() => startOfMonth(anchorDate).getTime(), [anchorDate]);
  const todayPulse = useUI((s) => s.todayPulse);

  const weekdayLabels = useMemo(() => {
    const week = startOfWeek(new Date(2024, 0, 7), { weekStartsOn: weekStart });
    return Array.from({ length: 7 }, (_, i) => format(addDays(week, i), "EEE"));
  }, [weekStart]);

  const weeks = useMemo<Week[]>(() => {
    if (months.length === 0) return [];
    const first = startOfWeek(startOfMonth(months[0].getTime()), { weekStartsOn: weekStart });
    const lastMonth = months[months.length - 1];
    const lastDay = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0);
    const end = startOfWeek(lastDay, { weekStartsOn: weekStart });
    const out: Week[] = [];
    let cursor = first;
    for (let guard = 0; cursor <= end && guard < 800; guard++) {
      out.push({
        key: cursor.getTime(),
        days: Array.from({ length: 7 }, (_, i) => addDays(cursor, i)),
      });
      cursor = addDays(cursor, 7);
    }
    return out;
  }, [months, weekStart]);

  const todayKey = sod(Date.now());

  /**
   * One pass over the occurrences fills every rendered day, rather than one
   * pass per day: the stack can hold years of weeks, and each day only wants
   * the items that touch it.
   */
  const byDay = useMemo(() => {
    const map = new Map<number, Occurrence[]>();
    for (const week of weeks) {
      for (const day of week.days) map.set(sod(day.getTime()), []);
    }
    const push = (key: number, occ: Occurrence) => {
      const list = map.get(key);
      if (list) list.push(occ);
    };

    for (const occ of occurrences) {
      if (occ.isDue) {
        push(sod(occ.start), occ);
        continue;
      }
      let cursor = sod(occ.start);
      const last = sod(Math.max(occ.end - 1, occ.start));
      for (let guard = 0; guard < 400; guard++) {
        push(cursor, occ);
        if (cursor >= last) break;
        const next = sod(addDays(new Date(cursor), 1).getTime());
        if (next <= cursor) break;
        cursor = next;
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(a.isDue) - Number(b.isDue) || a.start - b.start);
    }
    return map;
  }, [weeks, occurrences]);

  /** Goals due on each day. Open goals have no deadline, so they stay out. */
  const goalDeadlines = useMemo(() => {
    const map = new Map<number, Goal[]>();
    for (const goal of goals) {
      const deadline = goalDeadlineKey(goal);
      if (deadline == null) continue;
      const list = map.get(deadline) ?? [];
      list.push(goal);
      map.set(deadline, list);
    }
    return map;
  }, [goals]);

  /** Stop a settle glide mid-flight; a fresh gesture takes over from there. */
  const cancelGlide = useCallback(() => {
    const glide = glideRef.current;
    if (!glide) return;
    glideRef.current = null;
    window.cancelAnimationFrame(glide.frame);
    window.clearTimeout(glide.guard);
  }, []);

  /**
   * Weeks come to rest under a snap rather than wherever a trackpad let go.
   * The app eases the last stretch itself, frame by frame, so a short
   * correction reads as a nudge instead of a jump.
   */
  const glideTo = (el: HTMLDivElement, to: number) => {
    cancelGlide();
    const from = el.scrollTop;
    if (Math.abs(to - from) < 0.5) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.scrollTop = to;
      return;
    }
    const duration = glideDuration(to - from);
    const started = performance.now();
    const glide = { frame: 0, guard: 0 };
    const finish = () => {
      if (glideRef.current !== glide) return;
      glideRef.current = null;
      window.clearTimeout(glide.guard);
      el.scrollTop = to;
    };
    const step = (now: number) => {
      if (glideRef.current !== glide) return;
      const elapsed = now - started;
      if (elapsed >= duration) {
        finish();
        return;
      }
      el.scrollTop = glideTop(from, to, elapsed, duration);
      glide.frame = window.requestAnimationFrame(step);
    };
    glideRef.current = glide;
    glide.frame = window.requestAnimationFrame(step);
    // A webview that stops drawing frames (a hidden window) would leave the
    // glide pending and swallow the next scroll; land it instead.
    glide.guard = window.setTimeout(finish, duration + 150);
  };

  const monthOfWeek = (index: number): number => {
    const week = weeks[Math.min(weeks.length - 1, Math.max(0, index))];
    if (!week) return labelMonth;
    // The week holding today is named for today's month, even when most of its
    // days belong to the month before.
    if (week.days.some((day) => sod(day.getTime()) === todayKey)) {
      return startOfMonth(Date.now()).getTime();
    }
    return startOfMonth(week.days[3].getTime()).getTime();
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // The glide's own frames are not a reader's gesture, and must not arm
    // another settle or pull in more weeks.
    if (glideRef.current) return;

    if (onNeedMore && !extendLockRef.current) {
      if (el.scrollTop < weekHeight * 3) {
        extendLockRef.current = "start";
        prevScrollHeightRef.current = el.scrollHeight;
        onNeedMore(-1);
      } else if (el.scrollHeight - el.clientHeight - el.scrollTop < weekHeight * 3) {
        extendLockRef.current = "end";
        onNeedMore(1);
      }
    }

    const index = Math.round(el.scrollTop / weekHeight);
    const month = monthOfWeek(index);
    if (month !== labelMonth) setLabelMonth(month);
    // Scrolling only moves the label. It must never rewrite the anchor date:
    // doing so made Today jump to the first week of the neighbouring month.

    if (settleRef.current != null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null;
      const target = Math.max(
        0,
        Math.min(
          Math.round(el.scrollTop / weekHeight) * weekHeight,
          el.scrollHeight - el.clientHeight,
        ),
      );
      setLabelMonth(monthOfWeek(Math.round(target / weekHeight)));
      if (Math.abs(target - el.scrollTop) >= 1) glideTo(el, target);
    }, 120);
  };

  useEffect(() => {
    extendLockRef.current = null;
  }, [months.length]);

  // Any fresh gesture owns the scroll again, mid-glide or not.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("wheel", cancelGlide, { passive: true });
    el.addEventListener("touchstart", cancelGlide, { passive: true });
    el.addEventListener("pointerdown", cancelGlide, { passive: true });
    return () => {
      el.removeEventListener("wheel", cancelGlide);
      el.removeEventListener("touchstart", cancelGlide);
      el.removeEventListener("pointerdown", cancelGlide);
      cancelGlide();
    };
  }, [cancelGlide]);

  useEffect(
    () => () => {
      if (settleRef.current != null) window.clearTimeout(settleRef.current);
      cancelGlide();
    },
    [cancelGlide],
  );

  useEffect(
    () =>
      onCalendarScroll((dir, page) => {
        const el = scrollRef.current;
        if (!el) return;
        cancelGlide();
        const step = page ? el.clientHeight * 0.9 : weekHeight * 2;
        el.scrollBy({ top: (dir === "up" ? -1 : 1) * step, behavior: "smooth" });
      }),
    [weekHeight, cancelGlide],
  );

  // Weeks added at the top push everything down; keep the reader's place.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = weeks[0]?.key ?? null;
    const height = el.scrollHeight;
    if (first != null && firstWeekRef.current != null && first < firstWeekRef.current) {
      el.scrollTop += height - prevScrollHeightRef.current;
    }
    firstWeekRef.current = first;
    prevScrollHeightRef.current = height;
  }, [weeks]);

  // A month chosen from outside (arrows, Today, a year page) comes to the top;
  // weeks this view reported from scrolling, and months added at either end,
  // leave the reader where they are.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const focusedToday = lastTodayPulse.current !== todayPulse;
    if (!focusedToday && positionedRef.current === anchorMonthKey) return;
    // Focus the anchor's own day, not the first of its month: Today lands on
    // the week that contains today, and a month jump still lands on its 1st.
    const targetDay = sod(anchorDate);
    const index = weeks.findIndex((week) =>
      week.days.some((day) => sod(day.getTime()) === targetDay),
    );
    if (index < 0) return;
    cancelGlide();
    el.scrollTop = index * weekHeight;
    positionedRef.current = anchorMonthKey;
    lastTodayPulse.current = todayPulse;
    setLabelMonth(monthOfWeek(index));
  }, [anchorDate, anchorMonthKey, todayPulse, weeks, weekHeight, cancelGlide]);

  // Zooming changes every week's height, which the browser would otherwise
  // treat as ordinary content growth. Keep the same week under the eyes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const previous = prevRowHeightRef.current;
    prevRowHeightRef.current = rowHeight;
    if (!el || previous == null || previous === rowHeight) return;
    cancelGlide();
    const index = Math.round(el.scrollTop / (previous + 1));
    el.scrollTop = index * weekHeight;
  }, [rowHeight, weekHeight]);

  return (
    <div className="month">
      <div className="month-title-bar">
        <button
          onClick={() => onSelectMonth(labelMonth)}
          title="Jump to this month"
          aria-live="polite"
        >
          {format(labelMonth, "MMMM yyyy")}
        </button>
        <span className="month-title-meta">
          {weeks.length} {weeks.length === 1 ? "week" : "weeks"} in view
        </span>
      </div>
      <div className="month-weekdays">
        {weekdayLabels.map((label, i) => (
          <div key={i}>{label}</div>
        ))}
      </div>
      <div
        className="month-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ ["--month-row" as string]: `${rowHeight}px` }}
      >
        <div className="month-weeks">
          {weeks.map((week) => (
            <div className="month-week" key={week.key}>
              {week.days.map((day) => {
                const dayKey = sod(day.getTime());
                const isToday = dayKey === todayKey;
                const dueGoals = goalDeadlines.get(dayKey) ?? [];
                const items = byDay.get(dayKey) ?? [];
                // A deadline is the day's headline, so it takes a slot before events.
                const slots = Math.max(0, MAX_CHIPS - dueGoals.length);
                const shown = items.slice(0, slots);
                const hidden = items.length - shown.length;
                return (
                  <div
                    key={dayKey}
                    className="month-cell"
                    data-today={isToday}
                    data-drop={dropDay === String(dayKey)}
                    onDoubleClick={(e) => {
                      if (e.target !== e.currentTarget) return;
                      const start = dayKey + 9 * 3_600_000;
                      onCreate({ type: "event", start, end: start + 3_600_000, title: "" });
                    }}
                    onClick={(e) => {
                      if (!mobile || e.target !== e.currentTarget) return;
                      openSlotMenu(e, dayKey + 9 * 3_600_000);
                    }}
                    onContextMenu={(e) => {
                      if ((e.target as HTMLElement).closest(".month-event")) return;
                      openSlotMenu(e, dayKey + 9 * 3_600_000);
                    }}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes(DND_TYPE)) return;
                      e.preventDefault();
                      setDropDay(String(dayKey));
                    }}
                    onDragLeave={() => setDropDay((d) => (d === String(dayKey) ? null : d))}
                    onDrop={(e) => {
                      const id = e.dataTransfer.getData(DND_TYPE);
                      setDropDay(null);
                      if (!id) return;
                      e.preventDefault();
                      onScheduleTask(id, dayKey + 9 * 3_600_000);
                    }}
                  >
                    <button className="month-daynum" onClick={() => onSelectDay(day.getTime())}>
                      {format(day, "d")}
                    </button>
                    {/* A task due today is marked even when its time is
                        blocked out on another day. */}
                    {items.some((occ) => occ.isDue) && (
                      <span
                        className="month-due"
                        title={items
                          .filter((occ) => occ.isDue)
                          .map((occ) => `Due: ${occ.item.title || "Untitled"}`)
                          .join("\n")}
                      >
                        <Flag size={8} />
                      </span>
                    )}
                    {dueGoals.map((goal) => {
                      const color = resolveGoalColor(goal, projects);
                      return (
                        <button
                          key={goal.id}
                          className="month-event"
                          data-goal="true"
                          style={{ ["--ev-color" as string]: color }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenGoal(goal);
                          }}
                          title={`Goal deadline · ${goal.title || "Untitled goal"}`}
                        >
                          <Target size={9} style={{ color, flex: "none" }} />
                          <span className="ev-name">{goal.title || "Untitled goal"}</span>
                        </button>
                      );
                    })}
                    {shown.map((occ) => (
                      <MonthChip
                        key={occ.key}
                        occ={occ}
                        projects={projects}
                        highlight={highlight}
                        onOpen={() => onOpen(occ)}
                      />
                    ))}
                    {hidden > 0 && (
                      <button className="month-more" onClick={() => onSelectDay(day.getTime())}>
                        +{hidden} more
                      </button>
                    )}
                    <button
                      className="month-add"
                      title="New event"
                      onClick={() => {
                        const start = dayKey + 9 * 3_600_000;
                        onCreate({ type: "event", start, end: start + 3_600_000, title: "" });
                      }}
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthChip({
  occ,
  projects,
  highlight,
  onOpen,
}: {
  occ: Occurrence;
  projects: Project[];
  highlight?: CollectionHighlight | null;
  onOpen: () => void;
}) {
  const timeFormat = useTimeFormat();
  const color = resolveColor(occ.item, projects);
  const done = isDone(occ.item);
  return (
    <button
      className="month-event"
      data-done={done}
      data-due={occ.isDue ? "true" : undefined}
      data-schedule={occ.scheduleId ? "true" : undefined}
      data-holiday={occ.holiday ? "true" : undefined}
      data-highlight={isHighlightedOccurrence(occ, highlight) || undefined}
      onClick={onOpen}
      onContextMenu={(e) => {
        if (occ.holiday) return;
        openItemMenu(e, occ.item, occ);
      }}
      title={`${occ.isDue ? "Due: " : ""}${occ.item.title}${
        occ.item.location ? ` — ${occ.item.location}` : ""
      }`}
    >
      {occ.isDue ? (
        <Flag size={9} style={{ color, flex: "none" }} />
      ) : (
        <span className="ev-dot" style={{ background: color }} />
      )}
      {!occ.item.allDay && !occ.isDue && (
        <span className="ev-mini-time">{clockShort(occ.start, timeFormat)}</span>
      )}
      <span className="ev-name">{occ.item.title || "Untitled"}</span>
    </button>
  );
}
