import { useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CalendarClock, X } from "lucide-react";
import {
  useScheduleExceptions,
  useScheduleItems,
  useSchedules,
} from "../../db/hooks";
import { saveScheduleException } from "../../db/db";
import { useUI, type ScheduleOccurrenceTarget } from "../../store/ui";
import { sessionEnd } from "../../lib/schedule";
import type { Schedule, ScheduleException, ScheduleItem } from "../../types";
import { TimeField } from "../ui/TimeField";

/**
 * Edit exactly one generated timetable occurrence. Saving writes an exception
 * and leaves the recurring session — and every other week — untouched.
 */
export function ScheduleOccurrenceEditor() {
  const target = useUI((s) => s.scheduleOccurrence);
  const schedules = useSchedules();
  const items = useScheduleItems();
  const exceptions = useScheduleExceptions();

  const schedule = schedules.find((row) => row.id === target?.scheduleId);
  const session = items.find((row) => row.id === target?.sessionId);
  const exception = exceptions.find(
    (row) => row.sessionId === target?.sessionId && row.day === target?.day,
  );

  if (!target || !schedule || !session || exception?.kind === "delete") return null;

  // The form owns field state, so it must not mount until its session exists.
  // Live queries arrive after the first render; mounting earlier would seed
  // every field from an empty session and leave midnight in the time controls.
  return (
    <OccurrenceForm
      key={`${session.id}:${target.day}`}
      target={target}
      schedule={schedule}
      session={session}
      exception={exception}
    />
  );
}

function OccurrenceForm({
  target,
  schedule,
  session,
  exception,
}: {
  target: ScheduleOccurrenceTarget;
  schedule: Schedule;
  session: ScheduleItem;
  exception: ScheduleException | undefined;
}) {
  const close = useUI((s) => s.setScheduleOccurrence);
  const toast = useUI((s) => s.toast);

  const [title, setTitle] = useState(
    exception?.kind === "edit" ? (exception.title ?? session.name) : session.name,
  );
  const [location, setLocation] = useState(
    exception?.kind === "edit" ? (exception.location ?? "") : (session.location ?? ""),
  );
  const [startMin, setStartMin] = useState(
    exception?.kind === "edit"
      ? (exception.startMin ?? session.startMin)
      : session.startMin,
  );
  const [endMin, setEndMin] = useState(
    exception?.kind === "edit" ? (exception.endMin ?? sessionEnd(session)) : sessionEnd(session),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [close]);

  const dayLabel = format(target.day, "EEEE, MMMM d");
  const valid = title.trim().length > 0 && endMin > startMin;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await saveScheduleException({
        scheduleId: target.scheduleId,
        sessionId: target.sessionId,
        day: target.day,
        kind: "edit",
        title: title.trim(),
        location: location.trim() || undefined,
        startMin,
        endMin,
      });
      toast(`Updated only ${format(target.day, "MMM d")}`);
      close(null);
    } catch {
      toast("Couldn't save this occurrence", { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(null);
      }}
    >
      <div className="modal sched-dialog occ-dialog" role="dialog" aria-label="Edit one occurrence">
        <div className="modal-head">
          <span className="modal-title row" style={{ gap: 7 }}>
            <CalendarClock size={15} /> Edit one occurrence
          </span>
          <span className="spacer" />
          <button className="icon-btn" title="Close" onClick={() => close(null)}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="sched-hint occ-warning" role="note">
            <AlertTriangle size={14} />
            <span>
              Only the <strong>{dayLabel}</strong> occurrence changes. The weekly timetable
              and every other week stay unchanged.
            </span>
          </div>

          <label className="field">
            <span className="field-label">Title</span>
            <input
              className="input"
              value={title}
              autoFocus
              placeholder={session.name}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
            />
          </label>

          <label className="field">
            <span className="field-label">Location</span>
            <input
              className="input"
              value={location}
              placeholder={session.location ?? "Optional"}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>

          <div className="field">
            <span className="field-label">Time on this date</span>
            <div className="occ-times">
              <TimeField value={startMin} onChange={setStartMin} ariaLabel="Starts" step={1} />
              <span className="sched-dash">–</span>
              <TimeField
                value={endMin}
                onChange={setEndMin}
                ariaLabel="Ends"
                step={1}
                invalid={endMin <= startMin}
              />
            </div>
          </div>

          <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
            {schedule.name} · one occurrence on {dayLabel}
          </div>
        </div>

        <div className="dlg-foot">
          <button className="btn" onClick={() => close(null)}>
            Cancel
          </button>
          <span className="spacer" />
          <button className="btn primary" disabled={!valid || saving} onClick={() => void save()}>
            Save only this occurrence
          </button>
        </div>
      </div>
    </div>
  );
}
