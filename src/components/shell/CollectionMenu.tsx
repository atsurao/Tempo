import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  CalendarClock,
  CalendarDays,
  EyeOff,
  FolderKanban,
  LayoutGrid,
  Plus,
  Users,
  X,
} from "lucide-react";
import { PALETTE, type Item, type Project, type Schedule, type WorkProject } from "../../types";
import {
  useItems,
  useMembers,
  useProjects,
  useScheduleBreaks,
  useScheduleExceptions,
  useScheduleItems,
  useSchedules,
  useWorkProjects,
} from "../../db/hooks";
import { createProject, createSchedule, updateProject, updateSchedule } from "../../db/db";
import { useUI, type CollectionMenuKind } from "../../store/ui";
import { useOpenView } from "../../store/nav";
import { projectOverviews } from "../../lib/projects";
import { isDone } from "../../lib/tasks";
import { sessionsOf, scheduleSummary } from "../../lib/schedule";
import { nextCalendarDate, nextScheduleDate } from "../../lib/collectionFocus";
import { openCalendarMenu, openScheduleMenu, openWorkProjectMenu } from "../../store/contextMenu";
import { useIsMobile } from "../../hooks/useIsMobile";
import { DEFAULT_TERM_WEEKS } from "../editor/ScheduleEditor";
import { sod } from "../../lib/date";

const TITLES: Record<CollectionMenuKind, { title: string; hint: string; icon: typeof CalendarDays }> = {
  calendars: {
    title: "Calendars",
    hint: "Coloured groups for events and tasks.",
    icon: CalendarDays,
  },
  projects: {
    title: "Projects",
    hint: "Plans with dates, a team and a Gantt.",
    icon: FolderKanban,
  },
  schedules: {
    title: "Schedules",
    hint: "Weekly timetables and the breaks that pause them.",
    icon: CalendarClock,
  },
};

function dayLabel(ts: number | null | undefined): string {
  return ts == null ? "No deadline" : format(ts, "MMM d");
}

function MemberDots({ ids, members }: { ids: string[]; members: { id: string; name: string; color: string }[] }) {
  const shown = ids
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is NonNullable<typeof member> => Boolean(member))
    .slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <span className="collection-avatars" aria-label={`${shown.length} team members`}>
      {shown.map((member) => (
        <span
          className="member-avatar"
          key={member.id}
          style={{ background: member.color }}
          title={member.name}
        >
          {member.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      ))}
    </span>
  );
}

export function CollectionMenu() {
  const kind = useUI((s) => s.collectionMenu);
  const mobile = useIsMobile();
  const setMenu = useUI((s) => s.setCollectionMenu);
  const items = useItems();
  const calendars = useProjects();
  const workProjects = useWorkProjects();
  const schedules = useSchedules();
  const scheduleItems = useScheduleItems();
  const scheduleBreaks = useScheduleBreaks();
  const scheduleExceptions = useScheduleExceptions();
  const members = useMembers();
  const openView = useOpenView();
  const toast = useUI((s) => s.toast);
  const setAnchor = useUI((s) => s.setAnchor);
  const setCalendarMode = useUI((s) => s.setCalendarMode);
  const setFilterProject = useUI((s) => s.setFilterProject);
  const highlightCollection = useUI((s) => s.highlightCollection);
  const setSelectedWorkProject = useUI((s) => s.setSelectedWorkProject);
  const setProjectCreateOpen = useUI((s) => s.setProjectCreateOpen);
  const setScheduleEditor = useUI((s) => s.setScheduleEditor);
  const [addingSchedule, setAddingSchedule] = useState(false);
  const [newScheduleName, setNewScheduleName] = useState("");
  const [addingCalendar, setAddingCalendar] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState("");
  const addRowRef = useRef<HTMLDivElement>(null);

  const close = () => setMenu(null);

  /**
   * A half-typed name is abandoned when the menu closes, so reopening it always
   * starts from the compact plus rather than a stale input.
   */
  useEffect(() => {
    if (kind) return;
    setAddingCalendar(false);
    setNewCalendarName("");
    setAddingSchedule(false);
    setNewScheduleName("");
  }, [kind]);

  /** Clicking anywhere outside the name field cancels the creation. */
  useEffect(() => {
    if (!addingCalendar && !addingSchedule) return;
    const onDown = (event: PointerEvent) => {
      if (addRowRef.current?.contains(event.target as Node)) return;
      setAddingCalendar(false);
      setNewCalendarName("");
      setAddingSchedule(false);
      setNewScheduleName("");
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [addingCalendar, addingSchedule]);

  /**
   * The same flow the sidebar uses: the week itself is planned in the editor,
   * so a new schedule opens there immediately. Mobile has no sidebar to add
   * one from, so this menu is the entry point.
   */
  const addCalendar = async () => {
    const name = newCalendarName.trim();
    if (!name) {
      setAddingCalendar(false);
      return;
    }
    const project = await createProject(
      name,
      PALETTE[calendars.length % PALETTE.length],
      calendars.length,
    );
    setNewCalendarName("");
    setAddingCalendar(false);
    close();
    setFilterProject(project.id);
    openView("tasks");
  };

  const addSchedule = async () => {
    const name = newScheduleName.trim();
    if (!name) {
      setAddingSchedule(false);
      return;
    }
    const today = sod(Date.now());
    const schedule = await createSchedule({
      name,
      color: PALETTE[(calendars.length + schedules.length) % PALETTE.length],
      order: schedules.length,
      from: today,
      to: today + (DEFAULT_TERM_WEEKS * 7 - 1) * 86_400_000,
    });
    setNewScheduleName("");
    setAddingSchedule(false);
    close();
    setScheduleEditor(schedule.id);
  };
  const overviews = useMemo(
    () => projectOverviews(workProjects.filter((project) => !project.archivedAt), items),
    [workProjects, items],
  );

  useEffect(() => {
    if (!kind) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [kind]);

  if (!kind) return null;
  const meta = TITLES[kind];
  const Icon = meta.icon;

  const openProject = (project: WorkProject) => {
    close();
    setProjectCreateOpen(false);
    setSelectedWorkProject(project.id);
    openView("projects");
  };

  const showCalendar = (project: Project) => {
    const focus = nextCalendarDate(items, project.id);
    if (project.hidden) void updateProject(project.id, { hidden: false });
    if (focus != null) setAnchor(focus);
    setCalendarMode("week");
    setFilterProject(null);
    highlightCollection("calendar", project.id);
    close();
    openView("calendar", { keepCalendarAnchor: true });
    toast(`Highlighting “${project.name}”`);
  };

  const showSchedule = (schedule: Schedule) => {
    const focus = nextScheduleDate(
      schedule,
      scheduleItems,
      scheduleBreaks,
      Date.now(),
      scheduleExceptions,
    );
    if (schedule.hidden) void updateSchedule(schedule.id, { hidden: false });
    if (focus != null) setAnchor(focus);
    setCalendarMode("week");
    setFilterProject(null);
    highlightCollection("schedule", schedule.id);
    close();
    openView("calendar", { keepCalendarAnchor: true });
    toast(`Highlighting “${schedule.name}”`);
  };

  const owned = (project: Project): Item[] =>
    items.filter((item) => !item.deletedAt && item.projectId === project.id);

  return (
    <div
      className="modal-backdrop collection-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal collection-modal" role="dialog" aria-label={`${meta.title} overview`}>
        <div className="modal-head">
          <span className="collection-icon" aria-hidden>
            <Icon size={15} />
          </span>
          <div className="collection-heading">
            <span className="modal-title">{meta.title}</span>
            <span className="collection-hint">{meta.hint}</span>
          </div>
          <span className="spacer" />
          <button className="icon-btn" title="Close" aria-label="Close overview" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body collection-body">
          {kind === "calendars" && (
            <>
            <div className="collection-grid">
              {calendars.map((project) => {
                const itemsIn = owned(project);
                const open = itemsIn.filter((item) => item.type === "task" && !isDone(item)).length;
                const events = itemsIn.filter((item) => item.type === "event").length;
                const next = nextCalendarDate(items, project.id);
                return (
                  <button
                    className="collection-card"
                    key={project.id}
                    onClick={() => showCalendar(project)}
                    onContextMenu={(event) => {
                      close();
                      openCalendarMenu(event, project.id);
                    }}
                    title={`Show ${project.name} on the calendar`}
                  >
                    <span className="collection-card-rail" style={{ background: project.color }} />
                    <span className="collection-card-body">
                      <span className="collection-card-title">
                        {project.name}
                        {project.hidden && (
                          <span className="collection-hidden" title="Hidden from views">
                            <EyeOff size={10} /> hidden
                          </span>
                        )}
                      </span>
                      <span className="collection-card-meta">
                        <CalendarDays size={10} />
                        {open} open · {events} {events === 1 ? "event" : "events"}
                      </span>
                      <span className="collection-card-foot">
                        <span>{next == null ? "Nothing dated" : `next ${format(next, "MMM d")}`}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
              {calendars.length === 0 && (
                <div className="collection-empty">
                  <strong>No calendars yet</strong>
                  Add one from the Calendars section in the sidebar.
                </div>
              )}
            </div>

            {addingCalendar ? (
              <div className="collection-add-row" ref={addRowRef}>
                <input
                  className="input"
                  autoFocus
                  placeholder="Calendar name"
                  value={newCalendarName}
                  onChange={(e) => setNewCalendarName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addCalendar();
                    if (e.key === "Escape") {
                      setAddingCalendar(false);
                      setNewCalendarName("");
                    }
                  }}
                />
                <button className="btn sm primary" onClick={() => void addCalendar()}>
                  Create
                </button>
              </div>
            ) : (
              <button
                className="collection-add-tile"
                title="New calendar"
                aria-label="New calendar"
                onClick={() => setAddingCalendar(true)}
              >
                <Plus size={12} />
              </button>
            )}
            </>
          )}

          {kind === "projects" && (
            <>
            <div className="collection-grid">
              {overviews.map(({ project, open, done, pct, overdue, nextDue }) => (
                <button
                  className="collection-card"
                  key={project.id}
                  onClick={() => openProject(project)}
                  onContextMenu={(event) => {
                    close();
                    openWorkProjectMenu(event, project.id);
                  }}
                  title={`Open ${project.name}`}
                >
                  <span className="collection-card-rail" style={{ background: project.color }} />
                  <span className="collection-card-body">
                    <span className="collection-card-title">{project.name}</span>
                    <span className="collection-card-meta">
                      <CalendarDays size={10} />
                      {format(project.start, "MMM d")} – {dayLabel(project.deadline)}
                    </span>
                    <span className="project-progress">
                      <span style={{ width: `${pct}%`, background: project.color }} />
                    </span>
                    <span className="collection-card-foot">
                      <span>
                        {open} open · {done} done
                      </span>
                      {overdue > 0 ? (
                        <span className="project-warn">{overdue} overdue</span>
                      ) : nextDue != null ? (
                        <span>next {format(nextDue, "MMM d")}</span>
                      ) : null}
                      <span className="spacer" />
                      <MemberDots ids={project.memberIds} members={members} />
                      {project.memberIds.length > 0 && (
                        <span className="collection-team-count">
                          <Users size={9} /> {project.memberIds.length}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))}
              {overviews.length === 0 && (
                <div className="collection-empty">
                  <strong>No projects yet</strong>
                  <button
                    className="btn sm primary"
                    onClick={() => {
                      close();
                      setSelectedWorkProject(null);
                      setProjectCreateOpen(true);
                      openView("projects");
                    }}
                  >
                    Create a project
                  </button>
                </div>
              )}
            </div>

            {overviews.length > 0 && (
              <button
                className="collection-add-tile"
                title="New project"
                aria-label="New project"
                onClick={() => {
                  close();
                  setSelectedWorkProject(null);
                  setProjectCreateOpen(true);
                  openView("projects");
                }}
              >
                <Plus size={12} />
              </button>
            )}
            </>
          )}

          {kind === "schedules" && (
            <>
            <div className="collection-grid">
              {schedules.map((schedule) => {
                const sessions = sessionsOf(scheduleItems, schedule.id);
                const next = nextScheduleDate(
                  schedule,
                  scheduleItems,
                  scheduleBreaks,
                  Date.now(),
                  scheduleExceptions,
                );
                return (
                  <button
                    className="collection-card"
                    key={schedule.id}
                    onClick={() => showSchedule(schedule)}
                    onContextMenu={(event) => {
                      close();
                      openScheduleMenu(event, schedule.id);
                    }}
                    title={`Show ${schedule.name} on the calendar`}
                  >
                    <span className="collection-card-rail" style={{ background: schedule.color }} />
                    <span className="collection-card-body">
                      <span className="collection-card-title">
                        {schedule.name}
                        {schedule.hidden && (
                          <span className="collection-hidden" title="Hidden from views">
                            <EyeOff size={10} /> hidden
                          </span>
                        )}
                      </span>
                      <span className="collection-card-meta">
                        <CalendarClock size={10} />
                        {sessions.length} {sessions.length === 1 ? "session" : "sessions"} / week
                      </span>
                      <span className="collection-card-meta">
                        {format(schedule.from, "MMM d")} – {format(schedule.to, "MMM d, yyyy")}
                      </span>
                      <span className="collection-card-foot">
                        <span>
                          {next == null ? scheduleSummary(schedule, scheduleItems, scheduleBreaks) : `next ${format(next, "EEE, MMM d")}`}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
              {schedules.length === 0 && (
                <div className="collection-empty">
                  <strong>No schedules yet</strong>
                  <button
                    className="btn sm primary"
                    onClick={() => setAddingSchedule(true)}
                  >
                    Create a schedule
                  </button>
                </div>
              )}
            </div>

            {addingSchedule ? (
              <div className="collection-add-row" ref={addRowRef}>
                <input
                  className="input"
                  autoFocus
                  placeholder="Schedule name"
                  value={newScheduleName}
                  onChange={(e) => setNewScheduleName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addSchedule();
                    if (e.key === "Escape") {
                      setAddingSchedule(false);
                      setNewScheduleName("");
                    }
                  }}
                />
                <button className="btn sm primary" onClick={() => void addSchedule()}>
                  Create
                </button>
              </div>
            ) : schedules.length > 0 ? (
              <button
                className="collection-add-tile"
                title="New schedule"
                aria-label="New schedule"
                onClick={() => setAddingSchedule(true)}
              >
                <Plus size={12} />
              </button>
            ) : null}
            </>
          )}
        </div>

        <div className="collection-foot">
          <LayoutGrid size={11} />
          <span>
            {mobile
              ? "Tap a card to open it. Long-press for actions."
              : "Click a card to open it. Right-click for actions."}
          </span>
        </div>
      </div>
    </div>
  );
}
