import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, addMonths, addYears, startOfMonth } from "date-fns";
import { useUI } from "../../store/ui";
import { useGoals, useItems, useProjects, useTimetable } from "../../db/hooks";
import { buildOccurrences } from "../../lib/occurrences";
import { buildScheduleOccurrences, visibleSchedules } from "../../lib/schedule";
import { draftFromGoal, isGoalDone } from "../../lib/goals";
import { eod, monthSpanRange, sod, yearSpanRange, yearWindow } from "../../lib/date";
import {
  slideWeekWindow,
  weekWindowFor,
  windowCovers,
  type WeekWindow,
} from "../../lib/weekWindow";
import { draftFromItem } from "../../lib/draft";
import { hiddenCalendarIds, withoutHiddenCalendar } from "../../lib/calendars";
import { toggleTaskComplete, updateItem, overrideOccurrence } from "../../db/db";
import { blocksOf, blocksPatch, newBlock } from "../../lib/timeblocks";
import { holidayOccurrences } from "../../lib/holidays";
import type { Goal, Item, Occurrence } from "../../types";
import { masterOf } from "../../lib/tasks";
import { YearView } from "./YearView";
import { MonthView } from "./MonthView";
import { TimeGrid } from "./TimeGrid";
import { AgendaView } from "./AgendaView";

/** Years kept rendered around the year view's resting year. */
const YEAR_SPAN = 2;
/** Years between the resting year and an end before the window slides. */
const YEAR_SLIDE_AT = 1;
/**
 * Years brought in whenever the year view reaches an end of its window. Three
 * at a time means a reader heading steadily in one direction meets the loader
 * a third as often, and the years between two loads are already rendered.
 */
const YEAR_SLIDE_BY = 3;

/**
 * The week view is one continuous strip of days, not a page per week. It is
 * loaded a few weeks either side of the anchor and slides by four weeks when
 * the reader nears an end, so scrolling never hits a wall and the strip never
 * grows without limit (see lib/weekWindow).
 */

/** Same idea for the month view, a few months either side of the anchor. */
const MONTH_PAD = 6;
const MONTH_ADD = 6;
const MONTH_COUNT = MONTH_PAD * 2 + 1;

interface Span {
  from: number;
  count: number;
}

function monthSpan(anchor: number): Span {
  return { from: addMonths(startOfMonth(anchor), -MONTH_PAD).getTime(), count: MONTH_COUNT };
}

export function CalendarView() {
  const calendarMode = useUI((s) => s.calendarMode);
  const anchorDate = useUI((s) => s.anchorDate);
  const weekStart = useUI((s) => s.weekStart);
  const dayStartHour = useUI((s) => s.dayStartHour);
  const density = useUI((s) => s.density);
  const openCreate = useUI((s) => s.openCreate);
  const openEdit = useUI((s) => s.openEdit);
  const setAnchor = useUI((s) => s.setAnchor);
  const setCalendarMode = useUI((s) => s.setCalendarMode);
  const toast = useUI((s) => s.toast);
  const zoom = useUI((s) => s.calendarZoom[s.calendarMode]);
  const showHolidays = useUI((s) => s.showHolidays);
  const collectionHighlight = useUI((s) => s.collectionHighlight);
  const clearCollectionHighlight = useUI((s) => s.clearCollectionHighlight);

  useEffect(() => {
    if (!collectionHighlight) return;
    const remaining = Math.max(0, collectionHighlight.expiresAt - Date.now());
    const timer = window.setTimeout(clearCollectionHighlight, remaining);
    return () => window.clearTimeout(timer);
  }, [collectionHighlight?.nonce, collectionHighlight?.expiresAt, clearCollectionHighlight]);

  const items = useItems();
  const projects = useProjects();
  const goals = useGoals();
  const openGoalEdit = useUI((s) => s.openGoalEdit);

  // A hidden calendar takes its events and goals out of every calendar view
  // while leaving the items themselves — and their tasks — untouched.
  const hiddenCalendars = useMemo(() => hiddenCalendarIds(projects), [projects]);
  const visibleItems = useMemo(
    () => withoutHiddenCalendar(items, hiddenCalendars),
    [items, hiddenCalendars],
  );

  // Finished goals leave the calendar; they are history, not a plan.
  const activeGoals = useMemo(
    () =>
      withoutHiddenCalendar(
        goals.filter((g) => !g.deletedAt && !isGoalDone(g)),
        hiddenCalendars,
      ),
    [goals, hiddenCalendars],
  );

  const openGoal = (goal: Goal) => openGoalEdit(goal.id, draftFromGoal(goal));

  // The week and month views are continuous surfaces, so they own a loaded
  // window larger than the screen and grow it as the reader reaches an end.
  const [weekWindow, setWeekWindow] = useState<WeekWindow>(() =>
    weekWindowFor(anchorDate, weekStart),
  );
  const [monthWindow, setMonthWindow] = useState<Span>(() => monthSpan(anchorDate));

  // The trim looks at the anchor, which must be current even mid-fling.
  const weekAnchorRef = useRef(anchorDate);
  weekAnchorRef.current = anchorDate;

  // A jump from outside (Today, search, another view) can land past what is
  // loaded. Recentre only then, so ordinary scrolling never recreates the
  // strip underneath the reader.
  useEffect(() => {
    if (calendarMode !== "week") return;
    if (windowCovers(weekWindow, anchorDate)) return;
    setWeekWindow(weekWindowFor(anchorDate, weekStart));
  }, [anchorDate, calendarMode, weekStart, weekWindow]);

  useEffect(() => {
    if (calendarMode !== "month") return;
    const first = startOfMonth(monthWindow.from).getTime();
    const last = startOfMonth(
      addMonths(new Date(monthWindow.from), monthWindow.count - 1),
    ).getTime();
    const anchorMonth = startOfMonth(anchorDate).getTime();
    if (anchorMonth >= first && anchorMonth <= last) return;
    setMonthWindow(monthSpan(anchorDate));
  }, [anchorDate, calendarMode, monthWindow]);

  const extendWeek = useCallback((dir: -1 | 1) => {
    setWeekWindow((w) => slideWeekWindow(w, dir, weekAnchorRef.current));
  }, []);

  const extendMonth = useCallback((dir: -1 | 1) => {
    setMonthWindow((w) =>
      dir < 0
        ? { from: addMonths(new Date(w.from), -MONTH_ADD).getTime(), count: w.count + MONTH_ADD }
        : { ...w, count: w.count + MONTH_ADD },
    );
  }, []);

  // The year view scrolls through a window of years, and its pages need
  // occurrences too, so the window — not just the anchor — sets the fetch range.
  const [yearPages, setYearPages] = useState(() =>
    yearWindow(new Date(anchorDate).getFullYear(), YEAR_SPAN),
  );

  useEffect(() => {
    const year = new Date(anchorDate).getFullYear();
    setYearPages((pages) => (year >= pages.from && year <= pages.to ? pages : yearWindow(year, YEAR_SPAN)));
  }, [anchorDate]);

  /**
   * Slide the window, never rebuild it: years enter at the end the reader is
   * heading for and just as many leave behind them, so what is next is already
   * rendered by the time they get there and nothing on screen is torn down.
   */
  const slideYears = useCallback((year: number) => {
    // Three years of month grids at once is a lot of DOM; a transition lets
    // React interleave it with the scroll instead of freezing one frame.
    startTransition(() => {
      setYearPages((pages) => {
        const behind = year - pages.from;
        const ahead = pages.to - year;
        if (behind > YEAR_SLIDE_AT && ahead > YEAR_SLIDE_AT) return pages;
        const backwards = behind <= ahead;
        return backwards
          ? { from: pages.from - YEAR_SLIDE_BY, to: pages.to - YEAR_SLIDE_BY }
          : { from: pages.from + YEAR_SLIDE_BY, to: pages.to + YEAR_SLIDE_BY };
      });
    });
  }, []);

  // Stable handlers: the year pages are memoized, and a new function identity
  // on every render would re-render every year on screen.
  const selectDay = useCallback(
    (ts: number) => {
      setAnchor(ts);
      setCalendarMode("day");
    },
    [setAnchor, setCalendarMode],
  );

  const selectMonth = useCallback(
    (ts: number) => {
      setAnchor(ts);
      setCalendarMode("month");
    },
    [setAnchor, setCalendarMode],
  );

  const goToYear = useCallback((year: number) => {
    const { anchorDate: current, setAnchor: anchor } = useUI.getState();
    const delta = year - new Date(current).getFullYear();
    if (delta !== 0) anchor(addYears(new Date(current), delta).getTime());
  }, []);

  const years = useMemo(
    () => Array.from({ length: yearPages.to - yearPages.from + 1 }, (_, i) => yearPages.from + i),
    [yearPages],
  );

  const range = useMemo(() => {
    if (calendarMode === "year") return yearSpanRange(yearPages.from, yearPages.to);
    if (calendarMode === "month") {
      return monthSpanRange(monthWindow.from, monthWindow.count, weekStart);
    }
    if (calendarMode === "day") return { from: sod(anchorDate), to: eod(anchorDate) };
    if (calendarMode === "agenda") {
      return {
        from: sod(anchorDate),
        to: eod(addDays(new Date(anchorDate), 29).getTime()),
      };
    }
    return {
      from: weekWindow.from,
      to: eod(addDays(new Date(weekWindow.from), weekWindow.count - 1).getTime()),
    };
  }, [calendarMode, anchorDate, weekStart, yearPages, monthWindow, weekWindow]);

  // Fixed weekly schedules ride along with the events: the views draw one list,
  // and a term of classes needs no stored occurrences of its own.
  const timetable = useTimetable();
  const {
    schedules: scheduleRows,
    items: scheduleItems,
    breaks: scheduleBreaks,
    exceptions: scheduleExceptions,
  } = timetable;
  // A hidden timetable takes its sessions out of every calendar view, exactly
  // as a hidden calendar takes its events.
  const shownSchedules = useMemo(() => visibleSchedules(scheduleRows), [scheduleRows]);
  const occurrences = useMemo(
    () =>
      [
        ...buildOccurrences(visibleItems, range.from, range.to),
        ...buildScheduleOccurrences(
          {
            schedules: shownSchedules,
            items: scheduleItems,
            breaks: scheduleBreaks,
            exceptions: scheduleExceptions,
          },
          range.from,
          range.to,
        ),
        ...(showHolidays ? holidayOccurrences(range.from, range.to) : []),
      ].sort((a, b) => a.start - b.start),
    [
      visibleItems,
      range.from,
      range.to,
      shownSchedules,
      scheduleItems,
      scheduleBreaks,
      scheduleExceptions,
      showHolidays,
    ],
  );

  const days = useMemo(() => {
    if (calendarMode === "week") {
      return Array.from({ length: weekWindow.count }, (_, i) =>
        addDays(new Date(weekWindow.from), i),
      );
    }
    return [new Date(sod(anchorDate))];
  }, [calendarMode, anchorDate, weekWindow]);

  const months = useMemo(
    () =>
      Array.from({ length: monthWindow.count }, (_, i) =>
        startOfMonth(addMonths(new Date(monthWindow.from), i)),
      ),
    [monthWindow],
  );

  const handleOpen = (occ: Occurrence) => {
    if (occ.holiday) {
      toast(`${occ.item.title} · ${new Date(occ.start).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
      })}`);
      return;
    }
    // A timetable session opens the term it belongs to, not an editor for a
    // class that has no row of its own.
    if (occ.scheduleId) {
      useUI.getState().setScheduleEditor(occ.scheduleId);
      return;
    }
    openEdit(occ.item.id, draftFromItem(occ.item, occ), occ.originalStart);
  };

  const handleCreate = (start: number, end: number) => {
    openCreate({ type: "event", start, end, title: "" });
  };

  const handleChange = async (occ: Occurrence, start: number, end: number) => {
    // A session's time is the timetable's, not this week's.
    if (occ.scheduleId) return;
    const master = masterOf(occ.item, items);
    // A recurring block moves one occurrence, exactly as a recurring event
    // does; the exception remembers which block it came from.
    if (occ.isRecurring && occ.originalStart != null && (master.recurrence || occ.blockId)) {
      await overrideOccurrence(master, occ.originalStart, {
        start,
        end,
        recurrenceBlockId: occ.blockId ?? null,
      });
      toast("Moved this occurrence only", {
        actionLabel: "Undo",
        action: () => {
          void overrideOccurrence(master, occ.originalStart!, {
            start: occ.start,
            end: occ.end,
            recurrenceBlockId: occ.blockId ?? null,
          });
        },
      });
      return;
    }
    // One block of a task moved; the rest of its blocks stay where they are.
    if (occ.blockId) {
      const blocks = blocksOf(occ.item).map((block) =>
        block.id === occ.blockId ? { ...block, start, end } : block,
      );
      await updateItem(occ.item.id, blocksPatch(blocks));
      return;
    }
    await updateItem(occ.item.id, { start, end });
  };

  /** Dropping a task on the calendar books another block for it. */
  const scheduleTask = async (id: string, start: number) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const duration = Math.max(30, item.estimateMin ?? 60) * 60_000;
    const previous = { start: item.start, end: item.end, timeblocks: item.timeblocks };
    if (item.type === "task") {
      const blocks = [...blocksOf(item), newBlock(start, start + duration)];
      await updateItem(id, blocksPatch(blocks));
    } else {
      await updateItem(id, { start, end: start + duration });
    }
    toast(`Scheduled “${item.title}”`, {
      actionLabel: "Undo",
      action: () => {
        void updateItem(id, previous);
      },
    });
  };

  const handleToggle = async (item: Item) => {
    const result = await toggleTaskComplete(item);
    if (result.nextDue) {
      toast(`Next: ${new Date(result.nextDue).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
    }
  };

  if (calendarMode === "year") {
    return (
      <YearView
        zoom={zoom}
        years={years}
        anchorDate={anchorDate}
        weekStart={weekStart}
        occurrences={occurrences}
        goals={activeGoals}
        onSelectDay={selectDay}
        onSelectMonth={selectMonth}
        onYearChange={goToYear}
        onRecenter={slideYears}
        slideBy={YEAR_SLIDE_BY}
      />
    );
  }

  if (calendarMode === "month") {
    return (
      <MonthView
        anchorDate={anchorDate}
        months={months}
        zoom={zoom}
        onNeedMore={extendMonth}
        weekStart={weekStart}
        occurrences={occurrences}
        projects={projects}
        goals={activeGoals}
        highlight={collectionHighlight}
        onOpen={handleOpen}
        onOpenGoal={openGoal}
        onCreate={openCreate}
        onScheduleTask={scheduleTask}
        onSelectDay={(ts) => {
          setAnchor(ts);
          setCalendarMode("day");
        }}
        onSelectMonth={(ts) => setAnchor(ts)}
      />
    );
  }

  if (calendarMode === "agenda") {
    return (
      <AgendaView
        zoom={zoom}
        from={range.from}
        days={30}
        occurrences={occurrences}
        projects={projects}
        goals={activeGoals}
        highlight={collectionHighlight}
        onOpen={handleOpen}
        onOpenGoal={openGoal}
        onToggleTask={handleToggle}
      />
    );
  }

  return (
    <TimeGrid
      mode={calendarMode === "day" ? "day" : "week"}
      anchorDate={anchorDate}
      weekStart={weekStart}
      zoom={zoom}
      onNeedMore={calendarMode === "week" ? extendWeek : undefined}
      days={days}
      occurrences={occurrences}
      projects={projects}
      goals={activeGoals}
      highlight={collectionHighlight}
      onOpenGoal={openGoal}
      hourHeight={density === "compact" ? 40 : 48}
      scrollToHour={dayStartHour}
      onCreate={handleCreate}
      onOpen={handleOpen}
      onChange={handleChange}
      onSelectDay={(ts) => {
        setAnchor(ts);
        if (calendarMode === "week") setCalendarMode("day");
      }}
      onDropTask={scheduleTask}
    />
  );
}
