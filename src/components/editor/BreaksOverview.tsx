import { useEffect } from "react";
import { CalendarOff, ChevronRight, Pencil, X } from "lucide-react";
import { useScheduleBreaks, useScheduleItems, useSchedules } from "../../db/hooks";
import { useUI } from "../../store/ui";
import { sod } from "../../lib/date";
import {
  breakDays,
  breakDaysInTerm,
  breakDaysLabel,
  breaksByMonth,
  breaksOf,
  daysOffInTerm,
  sessionsOf,
  termDays,
  termRangeLabel,
} from "../../lib/schedule";
import { TermTimeline } from "./TermTimeline";

/**
 * A schedule's breaks, all of them, through the year: the term on one strip
 * with the holidays cut out of it, then every break in date order. Reading a
 * timetable back is a different job from editing it, so this is the quiet half
 * — browse the year, jump the calendar to a break, or step into the editor.
 */
export function BreaksOverview({ id }: { id: string }) {
  const schedules = useSchedules();
  const allItems = useScheduleItems();
  const allBreaks = useScheduleBreaks();
  const setAnchor = useUI((s) => s.setAnchor);
  const setScheduleEditor = useUI((s) => s.setScheduleEditor);
  const close = () => useUI.getState().setBreaksOverview(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The schedule editor may be open underneath; this sheet owns the key.
      e.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const schedule = schedules.find((s) => s.id === id);
  if (!schedule) return null;

  const breaks = breaksOf(allBreaks, id);
  const groups = breaksByMonth(breaks);
  const daysOff = daysOffInTerm(schedule, breaks);
  const inTerm = breaks.filter((brk) => breakDaysInTerm(schedule, brk) > 0).length;
  const sessions = sessionsOf(allItems, id).length;

  /** Jumping to a break lands the calendar on its first day. */
  const openWeek = (ts: number) => {
    setAnchor(sod(ts));
    close();
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal breaks-dialog" role="dialog" aria-label={`Breaks in ${schedule.name}`}>
        <div className="modal-head">
          <span className="modal-title row" style={{ gap: 7 }}>
            <span className="project-dot" style={{ background: schedule.color }} />
            Breaks · {schedule.name}
          </span>
          <span className="spacer" />
          <button className="icon-btn" title="Close" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="breaks-summary">
            <span>{termRangeLabel(schedule)}</span>
            <span className="dot" />
            <span>
              {termDays(schedule)} days · {sessions} session{sessions === 1 ? "" : "s"}
            </span>
            <span className="dot" />
            <span>
              {breaks.length} break{breaks.length === 1 ? "" : "s"} · {daysOff} day
              {daysOff === 1 ? "" : "s"} off
            </span>
          </div>

          <TermTimeline
            from={schedule.from}
            to={schedule.to}
            breaks={breaks}
            color={schedule.color}
            today={Date.now()}
          />

          {breaks.length === 0 && (
            <div className="breaks-empty">
              <CalendarOff size={15} />
              <span>
                No breaks in this schedule yet. Reading week, holidays and exam weeks are added in the
                timetable editor.
              </span>
            </div>
          )}

          {groups.map((group) => (
            <div className="breaks-group" key={group.key}>
              <div className="breaks-group-head">
                <span>{group.label}</span>
                {group.breaks.length > 1 && (
                  <>
                    <span className="spacer" />
                    <span className="sched-note">{group.breaks.length} breaks</span>
                  </>
                )}
              </div>
              {group.breaks.map((brk) => {
                const inside = breakDaysInTerm(schedule, brk);
                const partial = inside > 0 && inside < breakDays(brk);
                return (
                  <button
                    key={brk.id}
                    className="breaks-row"
                    onClick={() => openWeek(brk.from)}
                    title={`Show the week of ${breakDaysLabel(brk)}`}
                  >
                    <span className="breaks-bar" style={{ background: schedule.color }} />
                    <span className="breaks-name truncate">{brk.label || "Break"}</span>
                    <span className="breaks-dates">{breakDaysLabel(brk)}</span>
                    <span className="breaks-len">{breakDays(brk)}d</span>
                    {inside === 0 && <span className="breaks-tag">outside the term</span>}
                    {partial && <span className="breaks-tag">partly outside</span>}
                    <ChevronRight size={12} className="breaks-go" />
                  </button>
                );
              })}
            </div>
          ))}

          {inTerm < breaks.length && (
            <div className="sched-hint">
              {breaks.length - inTerm} of these fall outside {termRangeLabel(schedule)}, so the timetable
              runs as usual on those days. The calendar shows the term as it actually runs.
            </div>
          )}
        </div>

        <div className="dlg-foot">
          <span className="spacer" />
          <button className="btn sm" onClick={close}>
            Done
          </button>
          <button
            className="btn sm primary"
            onClick={() => {
              close();
              setScheduleEditor(schedule.id);
            }}
          >
            <Pencil size={11} /> Edit timetable
          </button>
        </div>
      </div>
    </div>
  );
}
