import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { format, isSameDay, startOfWeek } from "date-fns";
import { ChevronDown, Flag, Target } from "lucide-react";
import type { Goal, Occurrence, Project } from "../../types";
import { DAY, MINUTE, durationLabel, eod, minutesOfDay, sod } from "../../lib/date";
import { clamp } from "../../lib/id";
import { DND_TYPE, resolveColor } from "../../lib/draft";
import {
  goalTimeLabel,
  goalsInRange,
  resolveGoalColor,
  sortGoals,
  spanLabel,
} from "../../lib/goals";
import { openItemMenu, openSlotMenu } from "../../store/contextMenu";
import { clockHour, clockShort, clockTime } from "../../lib/clock";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { isHighlightedOccurrence, type CollectionHighlight } from "../../lib/collectionFocus";
import { onCalendarScroll } from "../../lib/calendarScroll";
import { glideDuration, glideTop } from "../../lib/glide";
import { useUI } from "../../store/ui";
import { isDone } from "../../lib/tasks";
import { useNow } from "../../db/hooks";
import { useIsMobile } from "../../hooks/useIsMobile";

export const HOUR_HEIGHT = 48;

/** Columns never get narrower than this, however far the view is zoomed out. */
const MIN_COLUMN = 36;
/** The all-day band stays compact until its content genuinely overflows. */
const ALL_DAY_COLLAPSED = 88;
const ALL_DAY_MIN = 34;

interface Block {
  occ: Occurrence;
  start: number;
  end: number;
  col: number;
  cols: number;
}

function packDay(occs: Occurrence[], dayStart: number, dayEnd: number): Block[] {
  // All-day items own a place in the all-day row; drawing them here too would
  // show every holiday and multi-day trip as a 12:00 – 11:59 block.
  const clipped = occs
    .filter(
      (o) =>
        !o.isDue &&
        !o.item.allDay &&
        o.start < dayEnd &&
        Math.max(o.end, o.start + 1) > dayStart,
    )
    .map((o) => ({
      occ: o,
      start: Math.max(o.start, dayStart),
      end: Math.min(o.end, dayEnd),
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const out: Block[] = [];
  let cluster: { b: (typeof clipped)[number]; col: number }[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) out.push({ ...c.b, col: c.col, cols });
    cluster = [];
  };

  for (const b of clipped) {
    if (cluster.length > 0 && b.start >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.b.end > b.start).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ b, col });
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  flush();
  return out;
}

interface DragState {
  kind: "create" | "move" | "resize";
  dayIndex: number;
  start: number;
  end: number;
  /**
   * Unclipped start of the dragged occurrence. A block spanning several days is
   * drawn clipped to the visible day, so committing `start` would silently move
   * the whole event to that day's midnight.
   */
  baseStart?: number;
  occ?: Occurrence;
  grabMin: number;
  x0: number;
  y0: number;
  moved: boolean;
  /** A fixed timetable slot: it can be clicked and read, never dragged. */
  locked?: boolean;
}

interface Props {
  /** `week` is a continuous strip of days; `day` is one fixed column. */
  mode: "week" | "day";
  anchorDate: number;
  weekStart: 0 | 1;
  /** 1 is fit-to-screen width; larger shows fewer days, smaller shows more. */
  zoom: number;
  /** called near either end of the loaded strip, in the direction of travel */
  onNeedMore?: (dir: -1 | 1) => void;
  days: Date[];
  occurrences: Occurrence[];
  projects: Project[];
  highlight?: CollectionHighlight | null;
  hourHeight?: number;
  scrollToHour?: number;
  onCreate: (start: number, end: number) => void;
  onOpen: (occ: Occurrence) => void;
  onChange: (occ: Occurrence, start: number, end: number) => void;
  onSelectDay: (ts: number) => void;
  onDropTask: (itemId: string, start: number) => void;
  /** goals running through the visible days, listed in their own fold-out row */
  goals: Goal[];
  onOpenGoal: (goal: Goal) => void;
}

export function TimeGrid({
  mode,
  anchorDate,
  weekStart,
  zoom,
  onNeedMore,
  days,
  occurrences,
  projects,
  highlight,
  hourHeight = HOUR_HEIGHT,
  scrollToHour = 7,
  onCreate,
  onOpen,
  onChange,
  onSelectDay,
  onDropTask,
  goals,
  onOpenGoal,
}: Props) {
  const timeFormat = useTimeFormat();
  const mobile = useIsMobile();
  const H = Math.max(24, Math.round(hourHeight * zoom));
  const gridHeight = 24 * H;
  const bodyRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDragState] = useState<DragState | null>(null);
  const [goalsOpen, setGoalsOpen] = useState(true);
  const [viewport, setViewport] = useState(0);
  const [allDayHeight, setAllDayHeight] = useState(ALL_DAY_COLLAPSED);
  const [completingAllDay, setCompletingAllDay] = useState<Set<string>>(() => new Set());
  const previousAllDayKeys = useRef<Set<string> | null>(null);
  const previousDoneAllDayKeys = useRef<Set<string> | null>(null);
  const allDayCompletionTimers = useRef(new Map<string, number>());
  const allDayResizeCleanup = useRef<(() => void) | null>(null);

  /**
   * The strip is `count` days wide, so the width of one column is the pane
   * width over seven at the default zoom: the whole week fits the screen on
   * open, and zooming is a plain scale of that fit.
   *
   * The readable minimum gives way in a pane too narrow to hold seven days at
   * it: a week spilling out of its own pane is worse than narrow days.
   */
  const colWidth = useMemo(() => {
    if (viewport <= 0) return 120;
    const usable = Math.max(80, viewport - 52);
    if (mode === "day") return usable;
    const fit = usable / 7;
    return Math.max(Math.min(MIN_COLUMN, fit), fit * zoom);
  }, [viewport, zoom, mode]);

  /**
   * The rendered day width is not always the predicted one: the phone layout
   * gives every day a fixed readable minimum, which overrides the fit above.
   * Scroll math must use what the browser actually drew, or every day index
   * drifts — which is how Today ended up a week or two in the past.
   */
  const [metrics, setMetrics] = useState({ column: 0 });
  const step = metrics.column > 0 ? metrics.column : colWidth;
  const now = useNow(60_000);
  const todayIndex = days.findIndex((d) => isSameDay(d, now));

  const cb = useRef({ days, onCreate, onOpen, onChange, onDropTask });
  cb.current = { days, onCreate, onOpen, onChange, onDropTask };

  const updateDrag = (d: DragState | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setViewport(el.clientWidth);
      const head = el.querySelector<HTMLElement>(".tg-dayhead");
      if (!head) return;
      const column = head.getBoundingClientRect().width;
      setMetrics((current) =>
        Math.abs(current.column - column) < 0.5 ? current : { column },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const strip = el.querySelector<HTMLElement>(".tg-sticky");
    if (strip) observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  // The week the anchor belongs to is what the strip lines up with the edge.
  const anchorWeekStart = useMemo(
    () => startOfWeek(anchorDate, { weekStartsOn: weekStart }).getTime(),
    [anchorDate, weekStart],
  );

  /** Last anchor this grid has already brought into position. */
  const positionedRef = useRef<number | null>(null);
  /** The day geometry the last alignment used, so a remeasure can re-run it. */
  const lastStepRef = useRef(0);
  /**
   * While the grid is being moved to an anchor, the webview still emits scroll
   * events for the position it is leaving. Reporting one would write the old
   * day back into the anchor and the view would re-align to the week before
   * today. Reports are ignored until this timestamp.
   */
  const reportSuppressRef = useRef(0);
  const todayPulse = useUI((s) => s.todayPulse);
  const lastTodayPulse = useRef(todayPulse);
  /** The first day of the strip the last positioning effect saw. */
  const stripStartRef = useRef<number | null>(null);
  const extendLockRef = useRef<"start" | "end" | null>(null);
  const anchorTimerRef = useRef<number | null>(null);
  const anchorPendingRef = useRef<number | null>(null);
  const settleRef = useRef<number | null>(null);
  const glideRef = useRef<{ frame: number; guard: number } | null>(null);

  /**
   * Report the day under the reader while they pan. The app bar follows it,
   * and so does the loaded window: a strip that only learns where its reader
   * is once scrolling stops cannot trim behind them, and grows without bound
   * for as long as the pan lasts.
   */
  const reportDay = (ts: number) => {
    if (Date.now() < reportSuppressRef.current) return;
    anchorPendingRef.current = ts;
    if (anchorTimerRef.current != null) return;
    anchorTimerRef.current = window.setTimeout(() => {
      anchorTimerRef.current = null;
      const next = anchorPendingRef.current;
      if (next == null) return;
      const state = useUI.getState();
      if (next !== state.anchorDate) {
        positionedRef.current = next;
        state.setAnchor(next);
      }
    }, 120);
  };

  useEffect(() => {
    const minuteFromY = (clientY: number): number => {
      const rect = bodyRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const raw = ((clientY - rect.top) / H) * 60;
      return clamp(Math.round(raw / 15) * 15, 0, 24 * 60);
    };
    const dayFromX = (clientX: number): number => {
      const rect = colsRef.current?.getBoundingClientRect();
      const count = cb.current.days.length;
      if (!rect || count <= 1) return 0;
      const width = rect.width / count;
      return clamp(Math.floor((clientX - rect.left) / width), 0, count - 1);
    };
    const dayStartOf = (index: number) => sod(cb.current.days[index].getTime());

    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.locked) return;
      if (!d.moved && Math.abs(ev.clientX - d.x0) < 4 && Math.abs(ev.clientY - d.y0) < 4) return;

      const pointerMin = minuteFromY(ev.clientY);
      if (d.kind === "create") {
        const startMin = (d.start - dayStartOf(d.dayIndex)) / MINUTE;
        const endMin = Math.max(startMin + 15, pointerMin);
        updateDrag({ ...d, moved: true, end: dayStartOf(d.dayIndex) + endMin * MINUTE });
        return;
      }
      if (d.kind === "move") {
        const dayIndex = dayFromX(ev.clientX);
        const durationMin = (d.end - d.start) / MINUTE;
        const startMin = clamp(Math.round((pointerMin - d.grabMin) / 15) * 15, 0, 24 * 60 - durationMin);
        updateDrag({
          ...d,
          moved: true,
          dayIndex,
          start: dayStartOf(dayIndex) + startMin * MINUTE,
          end: dayStartOf(dayIndex) + (startMin + durationMin) * MINUTE,
        });
        return;
      }
      const startMin = (d.start - dayStartOf(d.dayIndex)) / MINUTE;
      const endMin = clamp(Math.round(pointerMin / 15) * 15, startMin + 15, 24 * 60);
      updateDrag({ ...d, moved: true, end: dayStartOf(d.dayIndex) + endMin * MINUTE });
    };

    const up = () => {
      const d = dragRef.current;
      if (!d) return;
      updateDrag(null);
      if (d.kind === "create") {
        const end = d.end - d.start < 15 * MINUTE ? d.start + 60 * MINUTE : d.end;
        cb.current.onCreate(d.start, end);
        return;
      }
      if (!d.occ) return;
      if (!d.moved) cb.current.onOpen(d.occ);
      else if (d.kind === "resize") cb.current.onChange(d.occ, d.baseStart ?? d.start, d.end);
      else cb.current.onChange(d.occ, d.start, d.end);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [H]);

  /**
   * The strip holds a few weeks either side of the anchor. When the reader
   * scrolls near an end, ask for more days on that side; the prepend lands
   * before the reader's eyes and is compensated below.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, scrollToHour * H - 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the hour under the reader's eyes while zooming.
  const prevHeightRef = useRef(H);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && prevHeightRef.current !== H) {
      const hour = (el.scrollTop + 6) / prevHeightRef.current;
      el.scrollTop = Math.max(0, hour * H - 6);
    }
    prevHeightRef.current = H;
  }, [H]);

  // Days entering or leaving the start move every loaded column sideways;
  // hold the reader where they were. (The end needs no compensation.)
  const windowStart = days.length ? sod(days[0].getTime()) : null;
  const firstLoadedRef = useRef<number | null>(null);

  /**
   * Our own copy of the horizontal offset. WebKit applies a programmatic
   * `scrollLeft` to its scrolling layer asynchronously, so reading it back
   * right after writing can return the old value; two compensations in a row
   * would then both start from the same stale position and the second would
   * throw away the first. Keeping the number ourselves makes the arithmetic
   * independent of when the webview catches up.
   */
  const offsetRef = useRef(0);

  const setOffset = (el: HTMLElement, next: number) => {
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    const clamped = clamp(next, 0, max);
    offsetRef.current = clamped;
    el.scrollLeft = clamped;
    return clamped;
  };

  /** Stop a settle that is waiting or already gliding. */
  const cancelGlide = useCallback(() => {
    const glide = glideRef.current;
    if (glide) {
      glideRef.current = null;
      window.cancelAnimationFrame(glide.frame);
      window.clearTimeout(glide.guard);
    }
    if (settleRef.current != null) {
      window.clearTimeout(settleRef.current);
      settleRef.current = null;
    }
  }, []);

  /**
   * Days come to rest on a whole column rather than wherever a trackpad let
   * go. The easing is the same fixed, short tween used by the month view: a
   * native smooth scroll can spend a tiny correction in one frame, which reads
   * as a jolt instead of a nudge.
   */
  const glideTo = (el: HTMLDivElement, to: number) => {
    cancelGlide();
    const from = el.scrollLeft;
    if (Math.abs(to - from) < 0.5) {
      offsetRef.current = to;
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.scrollLeft = to;
      offsetRef.current = to;
      return;
    }
    const duration = glideDuration(to - from);
    const started = performance.now();
    const glide = { frame: 0, guard: 0 };
    const finish = () => {
      if (glideRef.current !== glide) return;
      glideRef.current = null;
      window.clearTimeout(glide.guard);
      el.scrollLeft = to;
      offsetRef.current = to;
    };
    const step = (now: number) => {
      if (glideRef.current !== glide) return;
      const elapsed = now - started;
      if (elapsed >= duration) {
        finish();
        return;
      }
      const next = glideTop(from, to, elapsed, duration);
      el.scrollLeft = next;
      offsetRef.current = next;
      glide.frame = window.requestAnimationFrame(step);
    };
    glideRef.current = glide;
    glide.frame = window.requestAnimationFrame(step);
    // A webview that stops drawing frames (a hidden window) would leave the
    // glide pending and swallow the next gesture; land it instead.
    glide.guard = window.setTimeout(finish, duration + 150);
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (windowStart != null && firstLoadedRef.current != null) {
      const shifted = Math.round((firstLoadedRef.current - windowStart) / DAY);
      if (shifted !== 0) setOffset(el, offsetRef.current + shifted * step);
    }
    firstLoadedRef.current = windowStart;
  }, [windowStart, step]);

  // A new anchor from outside (arrow keys, Today, another view) brings its
  // week to the left edge. Anchors this grid reported from scrolling, and
  // days added to either end of the strip, leave the reader where they are.
  useLayoutEffect(() => {
    if (mode !== "week") return;
    const el = scrollRef.current;
    if (!el) return;
    const stripStart = days.length ? sod(days[0].getTime()) : null;
    // A jump outside the loaded strip replaces the strip entirely. The scroll
    // offset from the old one no longer means anything, so the anchor has to
    // be lined up again even though positionedRef still names it. A strip that
    // merely slid kept the positioned day, and must not be nudged mid-pan.
    const replacedStrip =
      stripStart != null &&
      stripStartRef.current != null &&
      stripStart !== stripStartRef.current &&
      positionedRef.current != null &&
      !days.some((d) => sod(d.getTime()) === positionedRef.current);
    stripStartRef.current = stripStart;
    const fromToday = lastTodayPulse.current !== todayPulse;
    const stepChanged = Math.abs(lastStepRef.current - step) > 0.5;
    if (
      !fromToday &&
      !replacedStrip &&
      !stepChanged &&
      positionedRef.current === anchorDate
    ) {
      return;
    }
    // A phone keeps today's column at the edge whenever it is showing today's
    // week, including after a remeasure changes the day width. Desktop always
    // aligns the week itself.
    const focusDay =
      mobile && (fromToday || anchorDate === sod(Date.now())) && todayIndex >= 0
        ? sod(days[todayIndex].getTime())
        : anchorWeekStart;
    const index = days.findIndex((d) => sod(d.getTime()) === focusDay);
    if (index < 0) return;
    // Stop a settle aimed at the old day, and ignore the scroll events the
    // jump itself produces.
    cancelGlide();
    reportSuppressRef.current = Date.now() + 600;
    // The gutter is pinned over the strip, so the week's first day belongs at
    // x = gutter, which means the content itself scrolls to index * step.
    setOffset(el, index * step);
    positionedRef.current = anchorDate;
    lastTodayPulse.current = todayPulse;
    lastStepRef.current = step;
  }, [anchorDate, anchorWeekStart, days, step, mode, mobile, todayIndex, todayPulse, cancelGlide]);

  const handlePan = () => {
    const el = scrollRef.current;
    if (!el) return;
    offsetRef.current = el.scrollLeft;
    // The glide's own frames must not arm another settle or pull in more days.
    if (glideRef.current) return;

    if (onNeedMore && !extendLockRef.current) {
      const edge = step * 10;
      if (el.scrollLeft < edge) {
        extendLockRef.current = "start";
        onNeedMore(-1);
      } else if (el.scrollWidth - el.clientWidth - el.scrollLeft < edge) {
        extendLockRef.current = "end";
        onNeedMore(1);
      }
    }

    if (mode !== "week" || days.length === 0) return;
    const index = clamp(Math.round(el.scrollLeft / step), 0, days.length - 1);
    reportDay(sod(days[index].getTime()));

    // Let the pan finish, then bring the nearest day to the left edge. The
    // short delay keeps every scroll tick from starting its own settle.
    if (settleRef.current != null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null;
      const live = scrollRef.current;
      if (!live || glideRef.current) return;
      // The loaded strip can grow while this timer waits, so resolve the day
      // against the current window rather than the render that armed it.
      const liveDays = cb.current.days;
      if (liveDays.length === 0) return;
      const at = clamp(
        Math.round(live.scrollLeft / step),
        0,
        liveDays.length - 1,
      );
      const target = clamp(at * step, 0, live.scrollWidth - live.clientWidth);
      reportDay(sod(liveDays[at].getTime()));
      glideTo(live, target);
    }, 120);
  };

  // A trim keeps the strip the same length, so watch the window itself for
  // the change that lets the next edge request through.
  useEffect(() => {
    extendLockRef.current = null;
  }, [windowStart, days.length]);

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
      if (anchorTimerRef.current != null) window.clearTimeout(anchorTimerRef.current);
      cancelGlide();
    },
    [cancelGlide],
  );

  // Arrow keys move the hour the grid is showing; globals do the rest.
  useEffect(
    () =>
      onCalendarScroll((dir, page) => {
        const el = scrollRef.current;
        if (!el) return;
        const step = (page ? el.clientHeight * 0.9 : H) * (dir === "up" ? -1 : 1);
        el.scrollBy({ top: step, behavior: "smooth" });
      }),
    [H],
  );

  const activeKey = drag?.moved ? drag.occ?.key : undefined;

  /**
   * Goals are ongoing work, not events: one fold-out list for the whole visible
   * span keeps them out of the day columns without hiding them.
   */
  const visibleGoals = useMemo(() => {
    if (days.length === 0) return [];
    const from = sod(days[0].getTime());
    const to = eod(days[days.length - 1].getTime());
    return sortGoals(goalsInRange(goals, from, to));
  }, [days, goals]);

  const allDayKeys = useMemo(
    () => new Set(occurrences.filter((o) => o.isDue || o.item.allDay).map((o) => o.key)),
    [occurrences],
  );
  const allDayDoneKeys = useMemo(
    () =>
      new Set(
        occurrences
          .filter((o) => o.item.type === "task" && isDone(o.item) && (o.isDue || o.item.allDay))
          .map((o) => o.key),
      ),
    [occurrences],
  );

  // A chip leaves after the same short exit used by task rows. The transition
  // is detected against the previous all-day snapshot so old completed tasks
  // do not animate every time the calendar opens.
  useLayoutEffect(() => {
    const previousAll = previousAllDayKeys.current;
    const previousDone = previousDoneAllDayKeys.current;
    previousAllDayKeys.current = allDayKeys;
    previousDoneAllDayKeys.current = allDayDoneKeys;
    if (!previousAll || !previousDone) return;

    const reopened = [...previousDone].filter((key) => !allDayDoneKeys.has(key));
    if (reopened.length > 0) {
      for (const key of reopened) {
        const timer = allDayCompletionTimers.current.get(key);
        if (timer != null) window.clearTimeout(timer);
        allDayCompletionTimers.current.delete(key);
      }
      setCompletingAllDay((current) => {
        const next = new Set(current);
        for (const key of reopened) next.delete(key);
        return next;
      });
    }

    const completed = [...allDayDoneKeys].filter(
      (key) => !previousDone.has(key) && previousAll.has(key),
    );
    if (completed.length === 0) return;
    setCompletingAllDay((current) => new Set([...current, ...completed]));
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    for (const key of completed) {
      const timer = window.setTimeout(
        () => {
          allDayCompletionTimers.current.delete(key);
          setCompletingAllDay((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        },
        reduced ? 0 : 210,
      );
      allDayCompletionTimers.current.set(key, timer);
    }
  }, [allDayKeys, allDayDoneKeys]);

  useEffect(
    () => () => {
      for (const timer of allDayCompletionTimers.current.values()) window.clearTimeout(timer);
      allDayResizeCleanup.current?.();
    },
    [],
  );

  const allDayByDay = useMemo(() => {
    return days.map((day) => {
      const start = sod(day.getTime());
      const end = eod(start);
      return occurrences
        .filter((o) => {
          if (o.item.type === "task" && isDone(o.item) && !completingAllDay.has(o.key)) {
            return false;
          }
          if (o.isDue) return o.start >= start && o.start <= end;
          return o.item.allDay && o.start < end && Math.max(o.end, o.start + 1) > start;
        })
        .sort((a, b) => Number(a.isDue) - Number(b.isDue) || a.start - b.start);
    });
  }, [days, occurrences, completingAllDay]);

  // Chips have a fixed height, so the full band height is exact rather than a
  // measurement that could itself be changed by the cap.
  const allDayRows = allDayByDay.reduce((max, row) => Math.max(max, row.length), 0);
  const allDayNaturalHeight = allDayRows === 0 ? 0 : 5 + allDayRows * 17 + (allDayRows - 1) * 2;
  const allDayOverflow = allDayNaturalHeight > ALL_DAY_COLLAPSED;
  const currentAllDayHeight = Math.min(
    Math.max(allDayHeight, ALL_DAY_MIN),
    allDayNaturalHeight,
  );

  const beginAllDayResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!allDayOverflow) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const from = currentAllDayHeight;
    const move = (moveEvent: PointerEvent) => {
      setAllDayHeight(
        clamp(from + moveEvent.clientY - startY, ALL_DAY_MIN, allDayNaturalHeight),
      );
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (allDayResizeCleanup.current === finish) allDayResizeCleanup.current = null;
    };
    allDayResizeCleanup.current?.();
    allDayResizeCleanup.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return (
    <div
      className="tg"
      ref={scrollRef}
      onScroll={handlePan}
      style={{
        ["--tg-days" as string]: days.length,
        ["--tg-col" as string]: `${colWidth}px`,
        ["--tg-view" as string]: `${viewport}px`,
      }}
    >
      <div className="tg-sticky">
        <div className="tg-head">
          <div className="tg-head-gutter" />
          <div className="tg-head-days">
            {days.map((day, i) => {
              const isToday = i === todayIndex;
              return (
                <div
                  key={sod(day.getTime())}
                  className="tg-dayhead"
                  data-today={isToday}
                  onClick={() => onSelectDay(day.getTime())}
                  onContextMenu={(e) => openSlotMenu(e, sod(day.getTime()), true)}
                  title={format(day, "EEEE, MMMM d")}
                >
                  <span className="dow">{format(day, "EEE")}</span>
                  <span className="dnum">{format(day, "d")}</span>
                </div>
              );
            })}
          </div>
        </div>

        {visibleGoals.length > 0 && (
          <section className="tg-goals" data-open={goalsOpen} aria-label="Goals">
            <button
              className="tg-goals-head"
              onClick={() => setGoalsOpen((open) => !open)}
              aria-expanded={goalsOpen}
              title={goalsOpen ? "Fold goals" : "Show goals"}
            >
              <ChevronDown size={11} className="tg-goals-chevron" />
              <span className="tg-goals-title">Goals</span>
              <span className="tg-goals-count">{visibleGoals.length}</span>
            </button>
            {goalsOpen && (
              <div className="tg-goals-list">
                {visibleGoals.map((goal) => {
                  const color = resolveGoalColor(goal, projects);
                  return (
                    <button
                      key={goal.id}
                      className="tg-goal"
                      style={{ ["--ev-color" as string]: color }}
                      onClick={() => onOpenGoal(goal)}
                      title={`${goal.title || "Untitled goal"} · ${spanLabel(goal.span)} · ${goalTimeLabel(goal)}`}
                    >
                      <Target size={10} style={{ flex: "none" }} />
                      <span className="tg-goal-name">{goal.title || "Untitled goal"}</span>
                      <span className="tg-goal-when">{goalTimeLabel(goal)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <div
          className="tg-allday"
          data-overflow={allDayOverflow || undefined}
          style={
            allDayOverflow
              ? { ["--allday-height" as string]: `${currentAllDayHeight}px` }
              : undefined
          }
        >
          <div className="tg-allday-label">all-day</div>
          <div className="tg-allday-days">
            {days.map((day, i) => (
              <div
                key={sod(day.getTime())}
                className="tg-allday-col"
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(DND_TYPE)) e.preventDefault();
                }}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData(DND_TYPE);
                  if (!id) return;
                  e.preventDefault();
                  onDropTask(id, sod(day.getTime()) + 9 * 3_600_000);
                }}
                onContextMenu={(e) => {
                  if ((e.target as HTMLElement).closest(".allday-chip")) return;
                  openSlotMenu(e, sod(day.getTime()), true);
                }}
              >
                {allDayByDay[i].map((occ) => (
                  <button
                    key={occ.key}
                    className="allday-chip"
                    data-done={isDone(occ.item)}
                    data-completing={completingAllDay.has(occ.key) || undefined}
                    data-due={occ.isDue ? "true" : undefined}
                    data-highlight={isHighlightedOccurrence(occ, highlight) || undefined}
                    style={{ ["--ev-color" as string]: resolveColor(occ.item, projects) }}
                    onClick={() => onOpen(occ)}
                    onContextMenu={(e) => openItemMenu(e, occ.item, occ)}
                    title={`${occ.isDue ? "Due: " : ""}${occ.item.title}`}
                  >
                    {occ.isDue && <Flag size={8} style={{ flex: "none" }} />}
                    {occ.item.title || "Untitled"}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {allDayOverflow && (
            <div
              className="tg-allday-resizer"
              role="separator"
              tabIndex={0}
              aria-label="Resize the all-day section"
              aria-orientation="horizontal"
              aria-valuemin={ALL_DAY_MIN}
              aria-valuemax={allDayNaturalHeight}
              aria-valuenow={Math.round(currentAllDayHeight)}
              title="Drag to resize the all-day section"
              onPointerDown={beginAllDayResize}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                const delta = event.key === "ArrowDown" ? 24 : -24;
                setAllDayHeight((height) =>
                  clamp(height + delta, ALL_DAY_MIN, allDayNaturalHeight),
                );
              }}
            >
              <span />
            </div>
          )}
        </div>
      </div>

      <div className="tg-body" ref={bodyRef} style={{ height: gridHeight }}>
          <div className="tg-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="tg-hour-label" style={{ top: h * H }}>
                {clockHour(h, timeFormat)}
              </div>
            ))}
          </div>
          <div className="tg-cols" ref={colsRef}>
            {days.map((day, dayIndex) => {
              const dayStart = sod(day.getTime());
              const blocks = packDay(occurrences, dayStart, eod(dayStart));
              const isToday = dayIndex === todayIndex;
              const weekend = [0, 6].includes(day.getDay());
              return (
                <div
                  key={dayStart}
                  className="tg-col"
                  data-today={isToday}
                  data-weekend={weekend}
                  style={{ height: gridHeight }}
                  onPointerDown={(e) => {
                    // A finger that starts creating on touch-down would make the
                    // grid impossible to scroll. On a phone a tap opens the
                    // slot sheet and a drag stays a scroll.
                    if (mobile) return;
                    if (e.button !== 0) return;
                    if ((e.target as HTMLElement).closest(".ev")) return;
                    const rect = bodyRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const raw = ((e.clientY - rect.top) / H) * 60;
                    const startMin = clamp(Math.round(raw / 15) * 15, 0, 24 * 60 - 15);
                    updateDrag({
                      kind: "create",
                      dayIndex,
                      start: dayStart + startMin * MINUTE,
                      end: dayStart + (startMin + 60) * MINUTE,
                      grabMin: 0,
                      x0: e.clientX,
                      y0: e.clientY,
                      moved: false,
                    });
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    if (!mobile) return;
                    if ((e.target as HTMLElement).closest(".ev")) return;
                    const rect = bodyRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const raw = ((e.clientY - rect.top) / H) * 60;
                    const mins = clamp(Math.round(raw / 15) * 15, 0, 24 * 60);
                    openSlotMenu(e, dayStart + mins * MINUTE);
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(DND_TYPE)) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    const id = e.dataTransfer.getData(DND_TYPE);
                    if (!id) return;
                    e.preventDefault();
                    const rect = bodyRef.current?.getBoundingClientRect();
                    const raw = rect ? ((e.clientY - rect.top) / H) * 60 : 9 * 60;
                    const mins = clamp(Math.round(raw / 15) * 15, 0, 24 * 60 - 15);
                    onDropTask(id, dayStart + mins * MINUTE);
                  }}
                  onContextMenu={(e) => {
                    if ((e.target as HTMLElement).closest(".ev")) return;
                    const rect = bodyRef.current?.getBoundingClientRect();
                    const raw = rect ? ((e.clientY - rect.top) / H) * 60 : 9 * 60;
                    const mins = clamp(Math.round(raw / 15) * 15, 0, 24 * 60);
                    openSlotMenu(e, dayStart + mins * MINUTE);
                  }}
                >
                  {blocks.map((block) => {
                    if (block.occ.key === activeKey) return null;
                    const top = ((block.start - dayStart) / 3_600_000) * H;
                    const height = Math.max(((block.end - block.start) / 3_600_000) * H - 1, 15);
                    const widthPct = 100 / block.cols;
                    const color = resolveColor(block.occ.item, projects);
                    const compact = height < 26;
                    return (
                      <div
                        key={block.occ.key}
                        className="ev"
                        data-done={isDone(block.occ.item)}
                        data-compact={compact}
                        data-highlight={isHighlightedOccurrence(block.occ, highlight) || undefined}
                        style={{
                          top,
                          height,
                          left: `calc(${block.col * widthPct}% + 1px)`,
                          width: `calc(${widthPct}% - 3px)`,
                          ["--ev-color" as string]: color,
                        }}
                        data-schedule={block.occ.scheduleId ? "true" : undefined}
                        onContextMenu={(e) => openItemMenu(e, block.occ.item, block.occ)}
                        onClick={() => {
                          if (mobile) onOpen(block.occ);
                        }}
                        onPointerDown={(e) => {
                          if (mobile) return;
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          const rect = bodyRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          const pointerMin = ((e.clientY - rect.top) / H) * 60;
                          const startMin = (block.start - dayStart) / MINUTE;
                          updateDrag({
                            kind: "move",
                            dayIndex,
                            start: block.start,
                            end: block.end,
                            occ: block.occ,
                            grabMin: pointerMin - startMin,
                            x0: e.clientX,
                            y0: e.clientY,
                            moved: false,
                            locked: Boolean(block.occ.scheduleId),
                          });
                        }}
                      >
                        {compact ? (
                          <>
                            <span className="ev-title">{block.occ.item.title || "Untitled"}</span>
                            <span className="ev-time" style={{ marginLeft: "auto" }}>
                              {clockShort(block.start, timeFormat)}
                            </span>
                          </>
                        ) : (
                          <>
                            <div className="ev-time">
                              {clockTime(block.start, timeFormat)} – {clockTime(block.end, timeFormat)}
                            </div>
                            <div className="ev-title">{block.occ.item.title || "Untitled"}</div>
                            {/* A one-hour class still has room for its room. */}
                            {height > 38 && block.occ.item.location && (
                              <div className="ev-loc">{block.occ.item.location}</div>
                            )}
                          </>
                        )}
                        {!block.occ.scheduleId && (
                          <div
                            className="ev-resize"
                            onPointerDown={(e) => {
                              if (mobile) return;
                              if (e.button !== 0) return;
                              e.stopPropagation();
                              updateDrag({
                                kind: "resize",
                                dayIndex,
                                start: block.start,
                                end: block.end,
                                baseStart: block.occ.start,
                                occ: block.occ,
                                grabMin: 0,
                                x0: e.clientX,
                                y0: e.clientY,
                                moved: false,
                              });
                            }}
                          />
                        )}
                      </div>
                    );
                  })}

                  {isToday && (
                    <div
                      className="tg-now"
                      style={{ top: (minutesOfDay(now) / 60) * H }}
                      aria-hidden
                    />
                  )}

                  {drag?.moved && drag.dayIndex === dayIndex && (
                    <div
                      className="ev"
                      data-drag="true"
                      style={{
                        top: ((drag.start - dayStart) / 3_600_000) * H,
                        height: Math.max(((drag.end - drag.start) / 3_600_000) * H - 1, 15),
                        left: 1,
                        width: "calc(100% - 3px)",
                        ["--ev-color" as string]: drag.occ
                          ? resolveColor(drag.occ.item, projects)
                          : "var(--accent)",
                      }}
                    >
                      <div className="ev-time">
                        {clockTime(drag.start, timeFormat)} – {clockTime(drag.end, timeFormat)}
                        <span style={{ opacity: 0.7 }}> · {durationLabel((drag.end - drag.start) / MINUTE)}</span>
                      </div>
                      <div className="ev-title">
                        {drag.occ ? drag.occ.item.title : "New event"}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* One hour grid for the whole strip: a column per day would mean
                thousands of identical lines once the strip runs for months. */}
            <div className="tg-lines" aria-hidden>
              {Array.from({ length: 24 }, (_, h) => (
                <Fragment key={h}>
                  <div className="tg-line" style={{ top: h * H }} />
                  <div className="tg-line" data-half="true" style={{ top: (h + 0.5) * H }} />
                </Fragment>
              ))}
            </div>
          </div>
        </div>
    </div>
  );
}
