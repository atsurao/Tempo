import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarClock, CalendarOff, Check, Plus, Trash2, X } from "lucide-react";
import type { ScheduleBreak, ScheduleItem } from "../../types";
import { PALETTE } from "../../types";
import { useUI } from "../../store/ui";
import {
  useScheduleBreaks,
  useScheduleExceptions,
  useScheduleItems,
  useSchedules,
} from "../../db/hooks";
import { deleteSchedule, restoreSchedule, saveSchedulePlan, updateSchedule } from "../../db/db";
import { uid } from "../../lib/id";
import { addDays, sod } from "../../lib/date";
import {
  WEEKDAY_INITIALS,
  breakDays,
  breakDaysLabel,
  breaksOf,
  daysOffInTerm,
  formatClock,
  orderedWeekdays,
  parseClock,
  sessionEnd,
  sessionsOf,
  termDays,
  termRangeLabel,
} from "../../lib/schedule";
import { TermTimeline } from "./TermTimeline";
import { TimeField } from "../ui/TimeField";
import { TabStrip } from "../ui/TabStrip";
import { useIsMobile } from "../../hooks/useIsMobile";

/** A term usually runs about this long, used when a schedule is first made. */
export const DEFAULT_TERM_WEEKS = 14;

interface DraftItem {
  id: string;
  name: string;
  days: number[];
  start: string;
  end: string;
  location: string;
}

interface DraftBreak {
  id: string;
  label: string;
  from: string;
  to: string;
}

const dateValue = (ts: number) => format(ts, "yyyy-MM-dd");
const dayValue = (value: string) => new Date(`${value}T00:00`).getTime();

function draftItems(rows: ScheduleItem[]): DraftItem[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    days: [...row.days].sort((a, b) => a - b),
    start: formatClock(row.startMin),
    end: formatClock(sessionEnd(row)),
    location: row.location ?? "",
  }));
}

function draftBreaks(rows: ScheduleBreak[]): DraftBreak[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    from: dateValue(sod(row.from)),
    to: dateValue(sod(row.to)),
  }));
}

/**
 * Editing a fixed weekly timetable: the term it runs for, the sessions that
 * repeat every week, and the breaks that take days out of it.
 */
export function ScheduleEditor({ id }: { id: string }) {
  const schedules = useSchedules();
  const allItems = useScheduleItems();
  const allBreaks = useScheduleBreaks();
  const allExceptions = useScheduleExceptions();
  const weekStart = useUI((s) => s.weekStart);
  const toast = useUI((s) => s.toast);
  const close = () => useUI.getState().setScheduleEditor(null);

  const schedule = schedules.find((s) => s.id === id);
  const thisTerm = sod(Date.now());
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PALETTE[0]);
  const [from, setFrom] = useState(dateValue(thisTerm));
  const [to, setTo] = useState(
    dateValue(addDays(new Date(thisTerm), DEFAULT_TERM_WEEKS * 7 - 1).getTime()),
  );
  const [items, setItems] = useState<DraftItem[]>([]);
  const [breaks, setBreaks] = useState<DraftBreak[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const mobile = useIsMobile();
  const [tab, setTab] = useState<"term" | "sessions" | "breaks">("term");

  /**
   * The schedule and its plan arrive from live queries, and the first render
   * happens before they do: the sheet opens empty and fills itself once they
   * land. Anything typed before then is kept, because the load runs once.
   */
  useEffect(() => {
    if (!schedule || loaded) return;
    setName(schedule.name);
    setColor(schedule.color);
    setFrom(dateValue(schedule.from));
    setTo(dateValue(schedule.to));
    setItems(draftItems(sessionsOf(allItems, schedule.id)));
    setBreaks(draftBreaks(breaksOf(allBreaks, schedule.id)));
    setLoaded(true);
  }, [schedule, allItems, allBreaks, loaded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The breaks sheet can be stacked on top of this editor; it owns Escape.
      if (useUI.getState().breaksOverviewId) return;
      e.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const dayOrder = useMemo(() => orderedWeekdays(weekStart), [weekStart]);

  if (!schedule) return null;

  const termStart = dayValue(from);
  const termEnd = dayValue(to);
  const termBroken = !(termStart <= termEnd);
  const badItem = items.some((i) => parseClock(i.end) <= parseClock(i.start));
  const badBreak = breaks.some((b) => dayValue(b.to) < dayValue(b.from));
  const canSave = Boolean(name.trim()) && !termBroken && !badItem && !badBreak && !saving;
  /** The draft breaks as a term strip reads them, for the year-wide preview. */
  const draftSpans = breaks.map((row) => ({
    id: row.id,
    label: row.label,
    from: dayValue(row.from),
    to: dayValue(row.to),
  }));
  const term = { from: termStart, to: termEnd };
  // Days off only count the days the term actually covers, so a holiday that
  // spills past the last day of term is not counted twice.
  const daysOff = termBroken ? 0 : daysOffInTerm(term, draftSpans);
  const termLength = termBroken ? 0 : termDays(term);
  const dayRange = termBroken ? "" : termRangeLabel(term);

  const patchItem = (itemId: string, patch: Partial<DraftItem>) =>
    setItems((rows) => rows.map((row) => (row.id === itemId ? { ...row, ...patch } : row)));

  const toggleDay = (itemId: string, day: number) =>
    setItems((rows) =>
      rows.map((row) => {
        if (row.id !== itemId) return row;
        const days = row.days.includes(day)
          ? row.days.filter((d) => d !== day)
          : [...row.days, day].sort((a, b) => a - b);
        return { ...row, days };
      }),
    );

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await updateSchedule(schedule.id, { name: name.trim(), color, from: termStart, to: termEnd });
      await saveSchedulePlan(
        schedule.id,
        items.map((row, index) => ({
          id: row.id,
          scheduleId: schedule.id,
          name: row.name.trim() || "Untitled session",
          days: [...row.days].sort((a, b) => a - b),
          startMin: parseClock(row.start),
          endMin: parseClock(row.end),
          location: row.location.trim() || undefined,
          order: index,
        })),
        breaks.map((row) => ({
          id: row.id,
          scheduleId: schedule.id,
          label: row.label.trim() || "Break",
          from: dayValue(row.from),
          to: dayValue(row.to),
        })),
      );
      toast("Schedule saved");
      close();
    } finally {
      setSaving(false);
    }
  };

  /** Deleting a term is a big thing to lose, so it comes back in one click. */
  const remove = async () => {
    const sessions = sessionsOf(allItems, schedule.id);
    const brks = breaksOf(allBreaks, schedule.id);
    const exceptions = allExceptions.filter((row) => row.scheduleId === schedule.id);
    await deleteSchedule(schedule.id);
    close();
    toast(`Deleted “${schedule.name}”`, {
      actionLabel: "Undo",
      action: () => {
        void (async () => {
          await restoreSchedule(schedule, sessions, brks, exceptions);
        })();
      },
    });
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal sched-dialog" role="dialog" aria-label="Weekly schedule">
        <div className="modal-head">
          <span className="modal-title row" style={{ gap: 7 }}>
            <CalendarClock size={15} /> Weekly schedule
          </span>
          <span className="spacer" />
          <button className="icon-btn" title="Close" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {mobile && (
            <TabStrip
              value={tab}
              onChange={setTab}
              ariaLabel="Schedule sections"
              tabs={[
                { id: "term", label: "Term", icon: CalendarClock },
                { id: "sessions", label: "Sessions", badge: items.length },
                { id: "breaks", label: "Breaks", icon: CalendarOff, badge: breaks.length },
              ]}
            />
          )}

          <div
            className="sched-panel"
            data-mobile-panel="term"
            hidden={mobile && tab !== "term"}
          >
          <div className="sched-row">
            <label className="field" style={{ flex: 1 }}>
              <span className="field-label">Name</span>
              <input
                className="input"
                value={name}
                autoFocus
                placeholder="Fall 2026"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="field">
              <span className="field-label">Color</span>
              <div className="cal-colors">
                {PALETTE.map((value) => (
                  <button
                    key={value}
                    className="cal-color"
                    style={{ background: value }}
                    data-active={color === value}
                    aria-label={`Use ${value}`}
                    title={value}
                    onClick={() => setColor(value)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="sched-row">
            <label className="field">
              <span className="field-label">Runs from</span>
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Until</span>
              <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <div className="field" style={{ flex: 1 }}>
              <span className="field-label">This term</span>
              <span className="sched-note">
                {termBroken
                  ? "The term ends before it starts."
                  : `${dayRange} · ${termLength} days · ${items.length} weekly session${
                      items.length === 1 ? "" : "s"
                    }${daysOff > 0 ? ` · ${daysOff} days off` : ""}`}
              </span>
            </div>
          </div>

          {/* The term as one strip: sessions only run in the gaps. */}
          <TermTimeline from={termStart} to={termEnd} breaks={draftSpans} color={color} today={Date.now()} />
          </div>

          <div
            className="sched-panel"
            data-mobile-panel="sessions"
            hidden={mobile && tab !== "sessions"}
          >
          <div className="sched-head">
            <span>Weekly sessions</span>
            <span className="spacer" />
            <button
              className="btn sm"
              title="Add a session"
              onClick={() =>
                setItems((rows) => [
                  ...rows,
                  { id: uid("si"), name: "", days: [1, 3, 5], start: "09:00", end: "10:00", location: "" },
                ])
              }
            >
              <Plus size={11} /> Add session
            </button>
          </div>

          {items.length === 0 && (
            <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
              Nothing yet. Add the classes that repeat every week.
            </div>
          )}

          {items.map((row) => (
            <div className="sched-item" key={row.id}>
              <input
                className="input"
                placeholder="BIO 201 — Lecture"
                value={row.name}
                onChange={(e) => patchItem(row.id, { name: e.target.value })}
              />
              <div className="sched-days" role="group" aria-label="Days">
                {dayOrder.map((day) => (
                  <button
                    key={day}
                    className="sched-day"
                    data-active={row.days.includes(day)}
                    aria-pressed={row.days.includes(day)}
                    title={format(new Date(2024, 0, 7 + day), "EEEE")}
                    onClick={() => toggleDay(row.id, day)}
                  >
                    {WEEKDAY_INITIALS[day]}
                  </button>
                ))}
              </div>
              <TimeField
                className="sched-time"
                value={parseClock(row.start)}
                onChange={(minutes) => patchItem(row.id, { start: formatClock(minutes) })}
                ariaLabel="Starts"
                step={1}
              />
              <span className="sched-dash">–</span>
              <TimeField
                className="sched-time"
                value={parseClock(row.end)}
                onChange={(minutes) => patchItem(row.id, { end: formatClock(minutes) })}
                ariaLabel="Ends"
                step={1}
                invalid={parseClock(row.end) <= parseClock(row.start)}
              />
              <input
                className="input"
                placeholder="Location"
                value={row.location}
                onChange={(e) => patchItem(row.id, { location: e.target.value })}
              />
              <button
                className="icon-btn"
                title="Remove session"
                onClick={() => setItems((rows) => rows.filter((r) => r.id !== row.id))}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          </div>

          <div
            className="sched-panel"
            data-mobile-panel="breaks"
            hidden={mobile && tab !== "breaks"}
          >
          <div className="sched-head">
            <span>Breaks</span>
            <span className="sched-note">
              {breaks.length === 0
                ? "No breaks yet"
                : `${breaks.length} through the year · ${daysOff} day${daysOff === 1 ? "" : "s"} off`}
            </span>
            <span className="spacer" />
            {breaks.length > 0 && (
              <button
                className="btn sm"
                title="Read every break through the year"
                onClick={() => useUI.getState().setBreaksOverview(schedule.id)}
              >
                <CalendarOff size={11} /> Whole year
              </button>
            )}
            <button
              className="btn sm"
              title="Add a break"
              onClick={() =>
                setBreaks((rows) => [
                  ...rows,
                  {
                    id: uid("sb"),
                    label: "",
                    from: dateValue(addDays(new Date(termStart), 27).getTime()),
                    to: dateValue(addDays(new Date(termStart), 31).getTime()),
                  },
                ])
              }
            >
              <Plus size={11} /> Add break
            </button>
          </div>

          {breaks.length === 0 && (
            <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
              Reading week, holidays, exam week — the stretches the timetable skips.
            </div>
          )}

          {breaks.map((row) => {
            const bad = dayValue(row.to) < dayValue(row.from);
            const rowSpan = { from: dayValue(row.from), to: dayValue(row.to) };
            return (
              <div className="sched-break" key={row.id}>
                <input
                  className="input"
                  placeholder="Reading week"
                  value={row.label}
                  onChange={(e) =>
                    setBreaks((rows) => rows.map((r) => (r.id === row.id ? { ...r, label: e.target.value } : r)))
                  }
                />
                <input
                  className="input"
                  type="date"
                  value={row.from}
                  aria-label="First day"
                  onChange={(e) =>
                    setBreaks((rows) => rows.map((r) => (r.id === row.id ? { ...r, from: e.target.value } : r)))
                  }
                />
                <span className="sched-dash">–</span>
                <input
                  className="input"
                  type="date"
                  value={row.to}
                  aria-label="Last day"
                  data-bad={bad}
                  onChange={(e) =>
                    setBreaks((rows) => rows.map((r) => (r.id === row.id ? { ...r, to: e.target.value } : r)))
                  }
                />
                <span className="sched-note sched-span">
                  {bad
                    ? "Ends before it starts"
                    : `${breakDaysLabel(rowSpan)} · ${breakDays(rowSpan)}d`}
                </span>
                <button
                  className="icon-btn"
                  title="Remove break"
                  onClick={() => setBreaks((rows) => rows.filter((r) => r.id !== row.id))}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
          </div>

          <div className="sched-hint">
            Sessions repeat every week of the term, except on days a break covers — a break
            includes its first and last day. Editing here changes every week at once.
          </div>
        </div>

        <div className="dlg-foot">
          <button className="btn sm danger" onClick={() => void remove()}>
            <Trash2 size={11} /> Delete schedule
          </button>
          <span className="spacer" />
          <button className="btn sm" onClick={close}>
            Cancel
          </button>
          <button className="btn sm primary" onClick={() => void save()} disabled={!canSave}>
            <Check size={11} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
