import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Trash2, X } from "lucide-react";
import {
  useItems,
  useProjects,
  useScheduleBreaks,
  useScheduleItems,
  useSchedules,
} from "../../db/hooks";
import { deleteProject, deleteSchedule, updateProject } from "../../db/db";
import { useUI } from "../../store/ui";
import { PALETTE } from "../../types";
import { isDone } from "../../lib/tasks";

function useDialogEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
}

export function CalendarDialogs() {
  const settingsId = useUI((s) => s.calendarSettingsId);
  const deleteId = useUI((s) => s.calendarDeleteId);
  const scheduleDeleteId = useUI((s) => s.scheduleDeleteId);
  return (
    <>
      {settingsId && <CalendarSettings id={settingsId} />}
      {deleteId && <DeleteCalendar id={deleteId} />}
      {scheduleDeleteId && <DeleteSchedule id={scheduleDeleteId} />}
    </>
  );
}

function CalendarSettings({ id }: { id: string }) {
  const projects = useProjects();
  const items = useItems();
  const toast = useUI((s) => s.toast);
  const setCalendarDelete = useUI((s) => s.setCalendarDelete);
  const project = projects.find((p) => p.id === id);

  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(project?.color ?? PALETTE[0]);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setColor(project.color);
  }, [id, project?.name, project?.color]);

  const close = () => useUI.getState().setCalendarSettings(null);
  useDialogEscape(close);

  if (!project) return null;

  const owned = items.filter((i) => !i.deletedAt && i.projectId === project.id);
  const open = owned.filter((i) => i.type === "task" && !isDone(i)).length;

  const save = async () => {
    const next = name.trim();
    if (!next) return;
    await updateProject(project.id, { name: next, color });
    toast("Calendar updated");
    close();
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal cal-dialog" role="dialog" aria-label="Calendar settings">
        <div className="modal-head">
          <span className="modal-title">Calendar settings</span>
          <span className="spacer" />
          <button className="icon-btn" title="Close" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
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

          <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
            {owned.length} {owned.length === 1 ? "item" : "items"} · {open} open{" "}
            {open === 1 ? "task" : "tasks"}
          </div>
        </div>

        <div className="dlg-foot">
          <button
            className="btn sm danger"
            onClick={() => {
              setCalendarDelete(project.id);
              close();
            }}
          >
            <Trash2 size={11} /> Delete calendar
          </button>
          <span className="spacer" />
          <button className="btn sm" onClick={close}>
            Cancel
          </button>
          <button className="btn sm primary" onClick={() => void save()} disabled={!name.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteSchedule({ id }: { id: string }) {
  const schedules = useSchedules();
  const scheduleItems = useScheduleItems();
  const scheduleBreaks = useScheduleBreaks();
  const toast = useUI((s) => s.toast);
  const schedule = schedules.find((candidate) => candidate.id === id);
  const close = () => useUI.getState().setScheduleDelete(null);
  useDialogEscape(close);

  if (!schedule) return null;
  const sessions = scheduleItems.filter((item) => item.scheduleId === id).length;
  const breaks = scheduleBreaks.filter((item) => item.scheduleId === id).length;

  const confirm = async () => {
    await deleteSchedule(schedule.id);
    const state = useUI.getState();
    if (state.scheduleEditorId === schedule.id) state.setScheduleEditor(null);
    if (state.breaksOverviewId === schedule.id) state.setBreaksOverview(null);
    if (state.collectionHighlight?.kind === "schedule" && state.collectionHighlight.id === schedule.id) {
      state.clearCollectionHighlight();
    }
    close();
    toast(`Deleted “${schedule.name}”`);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal cal-dialog" role="alertdialog" aria-label="Delete schedule">
        <div className="modal-head">
          <span className="modal-title row" style={{ gap: 7 }}>
            <AlertTriangle size={15} style={{ color: "#e5484d" }} /> Delete schedule?
          </span>
          <span className="spacer" />
          <button className="icon-btn" title="Close" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.55 }}>
            <strong>{schedule.name}</strong> owns {sessions}{" "}
            {sessions === 1 ? "weekly session" : "weekly sessions"}
            {breaks > 0 && ` and ${breaks} ${breaks === 1 ? "break" : "breaks"}`}. Removing the
            timetable removes them from the calendar.
          </div>
          <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
            This cannot be undone.
          </div>
        </div>

        <div className="dlg-foot">
          <span className="spacer" />
          <button className="btn sm" onClick={close} autoFocus>
            Cancel
          </button>
          <button className="btn sm danger-solid" onClick={() => void confirm()}>
            <CalendarClock size={11} /> Delete schedule
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteCalendar({ id }: { id: string }) {
  const projects = useProjects();
  const items = useItems();
  const toast = useUI((s) => s.toast);
  const filterProjectId = useUI((s) => s.filterProjectId);
  const project = projects.find((p) => p.id === id);

  const close = () => useUI.getState().setCalendarDelete(null);
  useDialogEscape(close);

  if (!project) return null;

  const owned = items.filter((i) => !i.deletedAt && i.projectId === project.id);

  const confirm = async () => {
    await deleteProject(project.id);
    if (filterProjectId === project.id) useUI.getState().setFilterProject(null);
    useUI.getState().setCalendarSettings(null);
    close();
    toast(`Deleted “${project.name}”`);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal cal-dialog" role="alertdialog" aria-label="Delete calendar">
        <div className="modal-head">
          <span className="modal-title row" style={{ gap: 7 }}>
            <AlertTriangle size={15} style={{ color: "#e5484d" }} /> Delete calendar?
          </span>
          <span className="spacer" />
          <button className="icon-btn" title="Close" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.55 }}>
            <strong>{project.name}</strong>
            {owned.length > 0
              ? ` holds ${owned.length} ${owned.length === 1 ? "item" : "items"}. ${
                  owned.length === 1 ? "It stays" : "They stay"
                }, but moves to No calendar.`
              : " is empty. It can be removed safely."}
          </div>
          <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
            This cannot be undone.
          </div>
        </div>

        <div className="dlg-foot">
          <span className="spacer" />
          <button className="btn sm" onClick={close} autoFocus>
            Cancel
          </button>
          <button className="btn sm danger-solid" onClick={() => void confirm()}>
            <Trash2 size={11} /> Delete calendar
          </button>
        </div>
      </div>
    </div>
  );
}
