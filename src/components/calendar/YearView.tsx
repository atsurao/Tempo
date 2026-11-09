import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, getDaysInMonth, startOfMonth, startOfWeek } from "date-fns";
import { Loader2 } from "lucide-react";
import type { Goal, Occurrence } from "../../types";
import { sod } from "../../lib/date";
import { goalDateLabel, goalDeadlineKey, goalTimeLabel } from "../../lib/goals";
import { onCalendarScroll } from "../../lib/calendarScroll";

interface Props {
  /** 1 is the default page density; larger months, smaller year. */
  zoom: number;
  /** Calendar years rendered as pages, oldest first. */
  years: number[];
  anchorDate: number;
  weekStart: 0 | 1;
  occurrences: Occurrence[];
  /** goals ending on a day, marked only on their deadline day */
  goals: Goal[];
  onSelectDay: (ts: number) => void;
  onSelectMonth: (ts: number) => void;
  /** the year the view has come to rest on */
  onYearChange: (year: number) => void;
  /** the view is near an end of `years` and wants the window to slide over */
  onRecenter: (year: number) => void;
  /** how many years a slide brings in, so the waiting note can say so */
  slideBy: number;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** Day-start keys for every day that holds at least one item, with how many. */
function countByDay(occurrences: Occurrence[]): Map<number, number> {
  const counts = new Map<number, number>();
  const bump = (ts: number) => {
    const key = sod(ts);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (const occ of occurrences) {
    if (occ.isDue) {
      bump(occ.start);
      continue;
    }
    // Walk day by day so long events and DST changes both land on real dates.
    let cursor = sod(occ.start);
    const last = sod(Math.max(occ.end - 1, occ.start));
    for (let guard = 0; guard < 400; guard++) {
      bump(cursor);
      if (cursor >= last) break;
      const next = sod(addDays(new Date(cursor), 1).getTime());
      if (next <= cursor) break;
      cursor = next;
    }
  }
  return counts;
}

interface PageProps {
  year: number;
  weekStart: 0 | 1;
  todayKey: number;
  busy: Map<number, number>;
  deadlines: Map<number, Goal[]>;
  onSelectDay: (ts: number) => void;
  onSelectMonth: (ts: number) => void;
}

/**
 * One year of months. Kept apart from the scrolling view and memoized, so the
 * year sliding in at an end costs one page of work rather than re-rendering
 * every year on screen.
 */
const YearPage = memo(function YearPage({
  year,
  weekStart,
  todayKey,
  busy,
  deadlines,
  onSelectDay,
  onSelectMonth,
}: PageProps) {
  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const month = startOfMonth(new Date(year, i, 1));
      const lead = (month.getDay() - weekStart + 7) % 7;
      const cells: (number | null)[] = [
        ...Array.from({ length: lead }, () => null),
        ...Array.from({ length: getDaysInMonth(month) }, (_, d) => d + 1),
      ];
      while (cells.length % 7 !== 0) cells.push(null);
      return { month, cells };
    });
  }, [year, weekStart]);

  const weekdayLabels = useMemo(() => {
    const week = startOfWeek(new Date(2024, 0, 7), { weekStartsOn: weekStart });
    return Array.from({ length: 7 }, (_, i) => WEEKDAYS[addDays(week, i).getDay()]);
  }, [weekStart]);

  return (
    <section className="year" data-year={year}>
      {months.map(({ month, cells }) => (
        <section className="year-month" key={month.getMonth()}>
          <button
            className="year-month-name"
            onClick={() => onSelectMonth(month.getTime())}
            title={`Open ${month.toLocaleDateString(undefined, { month: "long" })}`}
          >
            {month.toLocaleDateString(undefined, { month: "long" })}
          </button>
          <div className="year-weekdays">
            {weekdayLabels.map((label, i) => (
              <span key={i}>{label}</span>
            ))}
          </div>
          <div className="year-grid">
            {cells.map((dayNumber, i) => {
              if (dayNumber == null) return <span key={i} className="year-blank" />;
              const key = sod(new Date(year, month.getMonth(), dayNumber).getTime());
              const count = busy.get(key) ?? 0;
              const due = deadlines.get(key) ?? [];
              return (
                <button
                  key={i}
                  className="year-day"
                  data-has={count > 0}
                  data-today={key === todayKey}
                  onClick={() => onSelectDay(key)}
                  title={
                    [
                      count > 0 ? `${count} item${count === 1 ? "" : "s"}` : null,
                      ...due.map(
                        (g) => `Goal deadline: ${g.title} · ${goalDateLabel(g)} · ${goalTimeLabel(g)}`,
                      ),
                    ]
                      .filter(Boolean)
                      .join("\n") || "Nothing scheduled"
                  }
                >
                  {dayNumber}
                  {count > 0 && <span className="year-dot" />}
                  {due.length > 0 && <span className="year-goal-mark" aria-hidden />}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </section>
  );
});

/**
 * One year per page, resting on each with a snap. The window of years is owned
 * by the calendar, so this view keeps the page the reader is on pinned to the
 * same place whenever that window slides underneath it.
 */
export function YearView({
  zoom,
  years,
  anchorDate,
  weekStart,
  occurrences,
  goals,
  onSelectDay,
  onSelectMonth,
  onYearChange,
  onRecenter,
  slideBy,
}: Props) {
  const anchorYear = new Date(anchorDate).getFullYear();
  const todayKey = sod(Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  /** pending "the reader has come to rest" timer */
  const settleRef = useRef<number | null>(null);
  /** pending "add the next year to the loaded window" timer */
  const recenterRef = useRef<number | null>(null);
  const [shownYear, setShownYear] = useState(anchorYear);
  /** which end of the loaded window is waiting for another year */
  const [edgeLoading, setEdgeLoading] = useState<"start" | "end" | null>(null);
  /** the year we last told the calendar about, so echoes don't move the view */
  const reportedRef = useRef(anchorYear);
  /** the page the reader is on and how far into it they are */
  const viewRef = useRef<{ year: number; offset: number } | null>(null);

  const busy = useMemo(() => countByDay(occurrences), [occurrences]);

  const deadlines = useMemo(() => {
    const map = new Map<number, Goal[]>();
    for (const goal of goals) {
      const key = goalDeadlineKey(goal);
      if (key == null) continue;
      const list = map.get(key) ?? [];
      list.push(goal);
      map.set(key, list);
    }
    return map;
  }, [goals]);

  const selectDay = useCallback((ts: number) => onSelectDay(ts), [onSelectDay]);
  const selectMonth = useCallback((ts: number) => onSelectMonth(ts), [onSelectMonth]);

  useEffect(
    () => () => {
      if (settleRef.current != null) clearTimeout(settleRef.current);
      if (recenterRef.current != null) clearTimeout(recenterRef.current);
    },
    [],
  );

  // The heading follows jumps from outside (arrows, Today, another view).
  useEffect(() => {
    setShownYear(anchorYear);
  }, [anchorYear]);

  // A year arrived: the edge is no longer waiting on anything.
  useEffect(() => {
    setEdgeLoading(null);
  }, [years]);

  /** The page covering most of the scrollport, with how far its top is above it. */
  const restingPage = (): { year: number; offset: number } | null => {
    const el = scrollRef.current;
    if (!el) return null;
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    let best: HTMLElement | null = null;
    let bestArea = 0;
    for (const page of el.querySelectorAll<HTMLElement>("[data-year]")) {
      const from = page.offsetTop;
      const visible = Math.min(from + page.offsetHeight, bottom) - Math.max(from, top);
      if (visible > bestArea) {
        bestArea = visible;
        best = page;
      }
    }
    if (!best) return null;
    return { year: Number(best.dataset.year), offset: top - best.offsetTop };
  };

  /**
   * Everything that follows a scroll waits for it to settle, so a flick that
   * carries through several snap points only ever reports the year it lands on.
   */
  const handleScroll = () => {
    const el = scrollRef.current;
    const view = restingPage();
    if (el && view) {
      setShownYear(view.year);
      // A loaded end is only reached when the scrollport itself is at that
      // end. Measuring the year instead would keep firing after the window
      // has already slid: the held page is one in from the new edge.
      const atStart = el.scrollTop <= 2;
      const atEnd = el.scrollTop >= el.scrollHeight - el.clientHeight - 2;
      // Say so while the next year is brought in, rather than letting the
      // reader hit an invisible floor.
      setEdgeLoading(atStart ? "start" : atEnd ? "end" : null);
    }

    if (settleRef.current != null) clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null;
      const scroller = scrollRef.current;
      if (!scroller) return;
      const rest = restingPage();
      if (!rest) return;
      viewRef.current = rest;
      if (rest.year !== reportedRef.current) {
        reportedRef.current = rest.year;
        onYearChange(rest.year);
      }
      const atStart = scroller.scrollTop <= 2;
      const atEnd = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 2;
      if (atStart || atEnd) {
        if (recenterRef.current != null) clearTimeout(recenterRef.current);
        recenterRef.current = window.setTimeout(() => {
          recenterRef.current = null;
          onRecenter(rest.year);
        }, 260);
      }
    }, 110);
  };

  useEffect(
    () =>
      onCalendarScroll((dir) => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollBy({ top: (dir === "up" ? -1 : 1) * el.clientHeight, behavior: "smooth" });
      }),
    [],
  );

  /** Re-pin the reader's page to the top when its height changes under them. */
  const pinPage = useCallback(() => {
    const el = scrollRef.current;
    const view = viewRef.current;
    if (!el || !view) return;
    const page = el.querySelector<HTMLElement>(`[data-year="${view.year}"]`);
    if (page) el.scrollTop = page.offsetTop;
  }, []);

  // A resized window or a new zoom level reflows every page, which would
  // otherwise leave the reader parked halfway down the year they were on.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(pinPage);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pinPage]);

  useLayoutEffect(pinPage, [pinPage, zoom]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pageOf = (year: number) => el.querySelector<HTMLElement>(`[data-year="${year}"]`);
    const settle = () => {
      if (settleRef.current != null) {
        clearTimeout(settleRef.current);
        settleRef.current = null;
      }
    };

    // Sliding the window of years moved the pages; hold the reader on theirs.
    const view = viewRef.current;
    const held = view && pageOf(view.year);
    if (anchorYear === reportedRef.current && held && view) {
      el.scrollTop = held.offsetTop + view.offset;
      return;
    }

    // Otherwise the year moved from outside — the arrows, Today, a jump back
    // from another view — and its page comes to the top.
    const target = pageOf(anchorYear);
    if (!target) return;
    settle();
    reportedRef.current = anchorYear;
    viewRef.current = { year: anchorYear, offset: 0 };
    el.scrollTop = target.offsetTop;
  }, [years, anchorYear]);

  // Name what is on its way: one year, or the range a multi-year slide fetches.
  const pendingFrom =
    edgeLoading === "start" ? years[0] - slideBy : years[years.length - 1] + 1;
  const pendingLabel =
    slideBy > 1 ? `${pendingFrom}–${pendingFrom + slideBy - 1}` : `${pendingFrom}`;

  return (
    <div className="year-view">
      <div className="year-heading">
        <span className="year-heading-label">Year</span>
        <span className="year-heading-year">{shownYear}</span>
      </div>
      <div className="year-frame">
        <div
          className="years"
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            ["--year-min" as string]: `${Math.round(150 * zoom)}px`,
            ["--year-day" as string]: `${Math.round(22 * Math.min(1.5, Math.max(0.85, zoom)))}px`,
          }}
        >
          {years.map((year) => (
            <YearPage
              key={year}
              year={year}
              weekStart={weekStart}
              todayKey={todayKey}
              busy={busy}
              deadlines={deadlines}
              onSelectDay={selectDay}
              onSelectMonth={selectMonth}
            />
          ))}
        </div>
        {edgeLoading && (
          <div className="year-loading" data-edge={edgeLoading} role="status">
            <Loader2 size={12} className="year-loading-spin" aria-hidden />
            <span>Loading {pendingLabel}…</span>
          </div>
        )}
      </div>
    </div>
  );
}
