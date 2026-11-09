import { useState } from "react";
import { Check, X } from "lucide-react";
import { format } from "date-fns";
import { createWorkProject } from "../../db/db";
import { useProjects, useWorkProjects } from "../../db/hooks";
import { useUI } from "../../store/ui";
import { PALETTE, type WorkProject } from "../../types";
import { DEFAULT_WORKING_DAYS } from "../../types";
import { sod } from "../../lib/date";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function inputDate(ts: number): string {
  return format(ts, "yyyy-MM-dd");
}

function dayEnd(value: string): number {
  return new Date(`${value}T23:59:59.999`).getTime();
}

interface Props {
  onCreated?: (project: WorkProject) => void;
  onCancel?: () => void;
}

/**
 * Creating a project is the only place its plan settings are asked for. The
 * defaults are deliberately useful: start today, work Monday to Friday.
 */
export function ProjectCreateForm({ onCreated, onCancel }: Props) {
  const projects = useWorkProjects();
  const calendars = useProjects();
  const toast = useUI((s) => s.toast);
  const setProjectCreateOpen = useUI((s) => s.setProjectCreateOpen);
  const setSelectedWorkProject = useUI((s) => s.setSelectedWorkProject);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[projects.length % PALETTE.length]);
  const [start, setStart] = useState(inputDate(Date.now()));
  const [deadline, setDeadline] = useState("");
  const [workingDays, setWorkingDays] = useState<number[]>([...DEFAULT_WORKING_DAYS]);
  const [calendarId, setCalendarId] = useState("");
  const [busy, setBusy] = useState(false);

  const toggleDay = (day: number) => {
    setWorkingDays((days) => {
      if (days.includes(day)) {
        return days.length === 1 ? days : days.filter((d) => d !== day);
      }
      return [...days, day].sort((a, b) => a - b);
    });
  };

  const submit = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const project = await createWorkProject({
        name: clean,
        color,
        order: projects.length,
        start: start ? new Date(`${start}T00:00`).getTime() : sod(Date.now()),
        deadline: deadline ? dayEnd(deadline) : null,
        workingDays,
        calendarId: calendarId || null,
      });
      setName("");
      setDeadline("");
      setProjectCreateOpen(false);
      setSelectedWorkProject(project.id);
      toast(`Created “${project.name}”`, { tone: "success" });
      onCreated?.(project);
    } catch {
      toast("Could not create that project", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setProjectCreateOpen(false);
    onCancel?.();
  };

  return (
    <form
      className="project-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="project-form-head">
        <input
          className="project-form-title"
          autoFocus
          value={name}
          placeholder="Project name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
        />
        {onCancel && (
          <button className="icon-btn" type="button" title="Cancel" onClick={cancel}>
            <X size={13} />
          </button>
        )}
      </div>

      <div className="project-form-colors">
        {PALETTE.map((value) => (
          <button
            key={value}
            type="button"
            className="cal-color"
            style={{ background: value }}
            data-active={color === value}
            aria-label={`Use ${value}`}
            title={value}
            onClick={() => setColor(value)}
          />
        ))}
      </div>

      <div className="project-form-grid">
        <label className="field">
          <span className="field-label">Start</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Deadline</span>
          <div className="sheet-row">
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
            {deadline && (
              <button
                className="icon-btn"
                type="button"
                title="Clear deadline"
                onClick={() => setDeadline("")}
              >
                <X size={11} />
              </button>
            )}
          </div>
        </label>
      </div>

      <div className="field">
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
      </div>

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

      <div className="project-form-foot">
        <span className="faint">Plans start on the first working day.</span>
        <span className="spacer" />
        {onCancel && (
          <button className="btn sm subtle" type="button" onClick={cancel}>
            Cancel
          </button>
        )}
        <button className="btn sm primary" type="submit" disabled={!name.trim() || busy}>
          <Check size={11} /> {busy ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}
