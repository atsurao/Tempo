import { useState } from "react";
import { format } from "date-fns";
import { Check, X } from "lucide-react";
import { updateWorkProject } from "../../db/db";
import { useProjects, useWorkProjects } from "../../db/hooks";
import { useUI } from "../../store/ui";
import { PALETTE } from "../../types";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function inputDate(ts: number): string {
  return format(ts, "yyyy-MM-dd");
}

function dayEnd(value: string): number {
  return new Date(`${value}T23:59:59.999`).getTime();
}

/** Editing a project's own settings, from its context menu or the detail head. */
export function ProjectEditDialog() {
  const id = useUI((s) => s.projectEditId);
  const close = useUI((s) => s.closeProjectEdit);
  const projects = useWorkProjects();
  const calendars = useProjects();
  const toast = useUI((s) => s.toast);
  const project = projects.find((candidate) => candidate.id === id);

  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(project?.color ?? PALETTE[0]);
  const [start, setStart] = useState(project ? inputDate(project.start) : "");
  const [deadline, setDeadline] = useState(
    project?.deadline != null ? inputDate(project.deadline) : "",
  );
  const [workingDays, setWorkingDays] = useState<number[]>(
    project?.workingDays ?? [1, 2, 3, 4, 5],
  );
  const [calendarId, setCalendarId] = useState(project?.calendarId ?? "");
  const [busy, setBusy] = useState(false);

  if (!project || !id) return null;

  const toggleDay = (day: number) => {
    setWorkingDays((days) =>
      days.includes(day)
        ? days.length === 1
          ? days
          : days.filter((value) => value !== day)
        : [...days, day].sort((a, b) => a - b),
    );
  };

  const save = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await updateWorkProject(project.id, {
        name: clean,
        color,
        start: start ? new Date(`${start}T00:00`).getTime() : project.start,
        deadline: deadline ? dayEnd(deadline) : null,
        workingDays,
        calendarId: calendarId || null,
      });
      toast(`Saved “${clean}”`, { tone: "success" });
      close();
    } catch {
      toast("Could not save that project", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <form
        className="modal project-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Edit project"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="modal-head">
          <span className="collection-icon" aria-hidden>
            <Check size={14} />
          </span>
          <div className="collection-heading">
            <span className="modal-title">Edit project</span>
            <span className="collection-hint">Name, plan dates and default calendar</span>
          </div>
          <span className="spacer" />
          <button className="icon-btn" type="button" title="Close" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body project-edit-body">
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <div className="field">
            <span className="field-label">Color</span>
            <div className="project-form-colors">
              {PALETTE.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="cal-color"
                  style={{ background: value }}
                  data-active={color === value}
                  title={value}
                  aria-label={`Use ${value}`}
                  onClick={() => setColor(value)}
                />
              ))}
            </div>
          </div>

          <div className="project-form-grid">
            <label className="field">
              <span className="field-label">Start</span>
              <input
                className="input"
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Finish</span>
              <div className="sheet-row">
                <input
                  className="input"
                  type="date"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                />
                {deadline && (
                  <button
                    className="icon-btn"
                    type="button"
                    title="Clear finish date"
                    onClick={() => setDeadline("")}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            </label>
          </div>

          <label className="field">
            <span className="field-label">Calendar</span>
            <select
              className="input"
              value={calendarId}
              onChange={(event) => setCalendarId(event.target.value)}
            >
              <option value="">No calendar</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span className="field-label">Working days</span>
            <div className="project-days">
              {DAY_LABELS.map((label, day) => (
                <button
                  key={day}
                  type="button"
                  className="project-day"
                  data-active={workingDays.includes(day)}
                  aria-pressed={workingDays.includes(day)}
                  title={format(new Date(2024, 0, 7 + day), "EEEE")}
                  onClick={() => toggleDay(day)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn" type="button" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={!name.trim() || busy}>
            <Check size={11} /> {busy ? "Saving…" : "Save project"}
          </button>
        </div>
      </form>
    </div>
  );
}
