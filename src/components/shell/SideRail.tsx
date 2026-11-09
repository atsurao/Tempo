import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from "react";
import {
  CalendarClock,
  CalendarOff,
  Check,
  ChevronDown,
  CircleDot,
  Eye,
  EyeOff,
  Folders,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import {
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  useUI,
  type PaneKind,
} from "../../store/ui";
import { useOpenView } from "../../store/nav";
import {
  useGoals,
  useHabitCheckins,
  useHabits,
  useItems,
  useProjects,
  useScheduleBreaks,
  useScheduleItems,
  useSchedules,
  useTags,
  useWorkProjects,
} from "../../db/hooks";
import { isDone } from "../../lib/tasks";
import { isGoalDone } from "../../lib/goals";
import { doneDays, habitsDueOn, isHabitDone } from "../../lib/habits";
import { hiddenCalendarIds, taskViewRows } from "../../lib/calendars";
import { buildTagUsage, tagColor } from "../../lib/tags";
import {
  createProject,
  createSchedule,
  createWorkProject,
  updateProject,
  updateSchedule,
  updateWorkProject,
} from "../../db/db";
import { DEFAULT_TERM_WEEKS } from "../editor/ScheduleEditor";
import { scheduleSummary, sessionsOf } from "../../lib/schedule";
import {
  openCalendarMenu,
  openScheduleMenu,
  openTagMenu,
  openWorkProjectMenu,
} from "../../store/contextMenu";
import { PALETTE, type Project, type Schedule, type WorkProject } from "../../types";
import { eod, sod } from "../../lib/date";
import { moveWithin, renumber } from "../../lib/order";
import { navView } from "./navViews";
import { useViewDrag } from "../../store/viewDrag";

type RowKind = "calendar" | "project" | "schedule";
interface RowTarget {
  kind: RowKind;
  index: number;
}

export function SideRail() {
  const collapsed = useUI((s) => s.railCollapsed);
  const toggleRail = useUI((s) => s.toggleRail);
  const setRailCollapsed = useUI((s) => s.setRailCollapsed);
  const railWidth = useUI((s) => s.railWidth);
  const setRailWidth = useUI((s) => s.setRailWidth);
  const railOrder = useUI((s) => s.railOrder);
  const railHidden = useUI((s) => s.railHidden);
  const setRailOrder = useUI((s) => s.setRailOrder);
  const activeView = useUI((s) => s.activeView);
  const keepOverdue = useUI((s) => s.keepOverdue);
  const filterProjectId = useUI((s) => s.filterProjectId);
  const filterTagId = useUI((s) => s.filterTagId);
  const setFilterProject = useUI((s) => s.setFilterProject);
  const setFilterTag = useUI((s) => s.setFilterTag);
  const setSettingsOpen = useUI((s) => s.setSettingsOpen);
  const setCalendarDelete = useUI((s) => s.setCalendarDelete);
  const selectedWorkProjectId = useUI((s) => s.selectedWorkProjectId);
  const setSelectedWorkProject = useUI((s) => s.setSelectedWorkProject);
  const setProjectCreateOpen = useUI((s) => s.setProjectCreateOpen);
  const setCollectionMenu = useUI((s) => s.setCollectionMenu);
  const openView = useOpenView();
  const beginViewDrag = useViewDrag((s) => s.begin);
  const endViewDrag = useViewDrag((s) => s.end);

  const items = useItems();
  const projects = useProjects();
  const tags = useTags();
  const workProjects = useWorkProjects();
  const goals = useGoals();
  const habits = useHabits();
  const habitCheckins = useHabitCheckins();
  const schedules = useSchedules();
  const scheduleItems = useScheduleItems();
  const scheduleBreaks = useScheduleBreaks();
  const setScheduleEditor = useUI((s) => s.setScheduleEditor);
  const setBreaksOverview = useUI((s) => s.setBreaksOverview);
  const toast = useUI((s) => s.toast);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [rowDrag, setRowDrag] = useState<RowTarget | null>(null);
  const [rowDrop, setRowDrop] = useState<RowTarget | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addingSchedule, setAddingSchedule] = useState(false);
  const [newScheduleName, setNewScheduleName] = useState("");
  const [addingWorkProject, setAddingWorkProject] = useState(false);
  const [newWorkProjectName, setNewWorkProjectName] = useState("");
  const [resizeFrom, setResizeFrom] = useState<{ x: number; width: number } | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);

  const tagUsage = useMemo(() => buildTagUsage(tags, items), [tags, items]);

  useEffect(() => {
    if (filterTagId) setTagsOpen(true);
  }, [filterTagId]);

  const todayStart = sod(Date.now());
  // The badge counts what the Today pane actually shows, hidden calendars and
  // all. Each calendar row keeps its own count so a hidden one can be gauged.
  const hiddenCalendars = useMemo(() => hiddenCalendarIds(projects), [projects]);
  const taskCounts = useMemo(() => {
    const open = taskViewRows(
      items.filter((i) => i.type === "task" && !i.deletedAt && !isDone(i)),
      hiddenCalendars,
      null,
      { keepOverdue },
    );
    return {
      today: open.filter((i) => i.dueAt != null && i.dueAt <= eod(todayStart)).length,
      total: open.length,
    };
  }, [items, hiddenCalendars, keepOverdue, todayStart]);

  const goalCount = useMemo(
    () => goals.filter((g) => !g.deletedAt && !isGoalDone(g)).length,
    [goals],
  );

  // The badge is the work still open today, not every habit in the list.
  const habitCount = useMemo(() => {
    const done = doneDays(habitCheckins);
    return habitsDueOn(
      habits.filter((habit) => !habit.archivedAt),
      todayStart,
    ).filter((habit) => !isHabitDone(done, habit.id, todayStart)).length;
  }, [habits, habitCheckins, todayStart]);

  const projectCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      if (item.type !== "task" || item.deletedAt || isDone(item) || !item.projectId) continue;
      map.set(item.projectId, (map.get(item.projectId) ?? 0) + 1);
    }
    return map;
  }, [items]);

  const workProjectCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      if (item.type !== "task" || item.deletedAt || isDone(item) || !item.workProjectId) continue;
      map.set(item.workProjectId, (map.get(item.workProjectId) ?? 0) + 1);
    }
    return map;
  }, [items]);

  /**
   * The width follows the pointer, so the rail moves under the edge rather
   * than jumping when the drag ends. The store keeps it inside its band.
   */
  useEffect(() => {
    if (!resizeFrom) return;
    const move = (e: PointerEvent) => setRailWidth(resizeFrom.width + e.clientX - resizeFrom.x);
    const up = () => setResizeFrom(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizeFrom, setRailWidth]);

  /** Hidden views keep their slot, so re-showing one puts it back in place. */
  const visibleRail = useMemo(
    () => railOrder.filter((key) => !railHidden.includes(key)),
    [railOrder, railHidden],
  );

  const onDrop = (target: number) => {
    if (dragIndex == null || dragIndex === target) {
      setDragIndex(null);
      setDropIndex(null);
      return;
    }
    const next = [...visibleRail];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(target, 0, moved);
    let cursor = 0;
    setRailOrder(
      railOrder.map((key) => (railHidden.includes(key) ? key : next[cursor++])),
    );
    setDragIndex(null);
    setDropIndex(null);
  };

  const visibleWorkProjects = useMemo(
    () => workProjects.filter((project) => !project.archivedAt),
    [workProjects],
  );

  /**
   * A dragged calendar, project or schedule is moved in its own list only, then
   * every row is renumbered so a reload puts them back in the same place. The
   * same HTML5 drag mechanic as the view buttons above; the rows simply carry
   * their own list key.
   */
  const moveRow = (kind: RowKind, from: number, to: number) => {
    if (kind === "calendar") {
      const next = renumber(moveWithin(projects, from, to));
      void Promise.all(next.map((project) => updateProject(project.id, { order: project.order })));
    } else if (kind === "project") {
      const next = renumber(moveWithin(visibleWorkProjects, from, to));
      void Promise.all(next.map((project) => updateWorkProject(project.id, { order: project.order })));
    } else {
      const next = renumber(moveWithin(schedules, from, to));
      void Promise.all(next.map((schedule) => updateSchedule(schedule.id, { order: schedule.order })));
    }
  };

  const rowDragProps = (kind: RowKind, index: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `${kind}:${index}`);
      setRowDrag({ kind, index });
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (rowDrag?.kind !== kind) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (rowDrop?.kind !== kind || rowDrop.index !== index) setRowDrop({ kind, index });
    },
    onDragLeave: () => {
      setRowDrop((current) =>
        current?.kind === kind && current.index === index ? null : current,
      );
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (rowDrag?.kind === kind) moveRow(kind, rowDrag.index, index);
      setRowDrag(null);
      setRowDrop(null);
    },
    onDragEnd: () => {
      setRowDrag(null);
      setRowDrop(null);
    },
  });

  const addProject = async () => {
    const name = newName.trim();
    if (!name) {
      setAdding(false);
      return;
    }
    const project = await createProject(name, PALETTE[projects.length % PALETTE.length], projects.length);
    setNewName("");
    setAdding(false);
    setFilterProject(project.id);
    openView("tasks");
  };

  const pickProject = (project: Project) => {
    setFilterProject(project.id);
    openView("tasks");
  };

  const pickTag = (id: string) => {
    setFilterTag(id);
    openView("tasks");
  };

  /**
   * Hiding is a view preference, so it happens at once and is undoable from the
   * toast rather than behind a confirmation.
   */
  const toggleHidden = (project: Project) => {
    const hidden = !project.hidden;
    void updateProject(project.id, { hidden });
    toast(hidden ? `Hidden “${project.name}”` : `Showing “${project.name}”`, {
      actionLabel: "Undo",
      action: () => void updateProject(project.id, { hidden: !hidden }),
    });
  };

  /** Same view preference as a calendar, applied to a whole timetable. */
  const toggleScheduleHidden = (schedule: Schedule) => {
    const hidden = !schedule.hidden;
    void updateSchedule(schedule.id, { hidden });
    toast(hidden ? `Hidden “${schedule.name}”` : `Showing “${schedule.name}”`, {
      actionLabel: "Undo",
      action: () => void updateSchedule(schedule.id, { hidden: !hidden }),
    });
  };

  /**
   * A new schedule opens straight in its editor: the name alone says nothing
   * about the week, and the term dates and sessions are set there.
   */
  const addWorkProject = async () => {
    const name = newWorkProjectName.trim();
    if (!name) {
      setAddingWorkProject(false);
      return;
    }
    const project = await createWorkProject({
      name,
      color: PALETTE[(projects.length + workProjects.length) % PALETTE.length],
      order: workProjects.length,
      start: sod(Date.now()),
    });
    setNewWorkProjectName("");
    setAddingWorkProject(false);
    setFilterProject(null);
    setProjectCreateOpen(false);
    setSelectedWorkProject(project.id);
    openView("projects");
  };

  const pickWorkProject = (project: WorkProject) => {
    setFilterProject(null);
    setProjectCreateOpen(false);
    setSelectedWorkProject(project.id);
    openView("projects");
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
      color: PALETTE[(projects.length + schedules.length) % PALETTE.length],
      order: schedules.length,
      from: today,
      to: today + (DEFAULT_TERM_WEEKS * 7 - 1) * 86_400_000,
    });
    setNewScheduleName("");
    setAddingSchedule(false);
    setScheduleEditor(schedule.id);
  };

  return (
    <aside
      className="rail"
      data-collapsed={collapsed}
      data-resizing={resizeFrom != null}
      style={{ width: collapsed ? undefined : railWidth }}
    >
      <div className="rail-head">
        {!collapsed && <span className="rail-head-label">Views</span>}
        <button
          className="icon-btn rail-toggle"
          onClick={toggleRail}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      {visibleRail.map((key, index) => {
        const def = navView(key);
        if (!def) return null;
        const Icon = def.icon;
        const count =
          key === "tasks"
            ? taskCounts.today
            : key === "projects"
              ? visibleWorkProjects.length
              : key === "goals"
                ? goalCount
                : key === "habits"
                  ? habitCount
                  : 0;
        return (
          /* The name rides outside the button so the pill can extend past the
             rail's edge instead of being clipped by it. */
          <div key={key} className="rail-tip-wrap">
            <button
              className="rail-item"
              data-active={activeView === key}
              data-dragging={dragIndex === index}
              data-drop={dropIndex === index && dragIndex !== index}
              draggable
              aria-label={def.label}
              aria-current={activeView === key ? "page" : undefined}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = "copyMove";
                e.dataTransfer.setData("application/x-tempo-view", key);
                e.dataTransfer.setData("text/plain", key);
                beginViewDrag(key);
                setDragIndex(index);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDropIndex(index);
              }}
              onDragLeave={() => setDropIndex((d) => (d === index ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(index);
                endViewDrag();
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDropIndex(null);
                endViewDrag();
              }}
              onClick={() => {
                setFilterProject(null);
                setFilterTag(null);
                if (key === "projects") {
                  setSelectedWorkProject(null);
                  setProjectCreateOpen(false);
                }
                openView(key as PaneKind);
              }}
            >
              <Icon size={15} />
              <span className="rail-text">{def.label}</span>
              {count > 0 && <span className="rail-count">{count}</span>}
            </button>
            <span className="rail-tip" aria-hidden>
              {def.label}
            </span>
          </div>
        );
      })}

      {collapsed ? (
        /* Folded, the calendars become one icon; hovering it opens the list
           beside the rail instead of widening it. */
        <div className="rail-flyout-wrap">
          <button
            className="rail-item rail-calendars"
            data-active={filterProjectId != null}
            aria-label="Calendars"
            aria-haspopup="true"
            onClick={() => setRailCollapsed(false)}
          >
            <Folders size={15} />
            <span className="rail-text">Calendars</span>
          </button>
          <div className="rail-flyout" role="menu" aria-label="Calendars">
            <div className="rail-flyout-head">Calendars</div>
            {projects.map((project) => (
              <button
                key={project.id}
                className="rail-project"
                data-active={filterProjectId === project.id}
                data-hidden={project.hidden ? "true" : undefined}
                role="menuitem"
                onClick={() => pickProject(project)}
                title={project.hidden ? `${project.name} (hidden)` : project.name}
              >
                <span className="project-dot" style={{ background: project.color }} />
                <span className="rail-text">{project.name}</span>
                <span className="rail-count">{projectCounts.get(project.id) ?? 0}</span>
              </button>
            ))}
            {projects.length === 0 && <div className="rail-flyout-empty">No calendars yet</div>}
            <div className="menu-sep" />
            <button
              className="rail-flyout-add"
              role="menuitem"
              onClick={() => {
                setRailCollapsed(false);
                setAdding(true);
              }}
            >
              <Plus size={12} />
              New calendar
            </button>
          </div>
        </div>
      ) : null}

      {collapsed ? (
        /* Schedules fold the same way: one icon, and the list beside the rail. */
        <div className="rail-flyout-wrap">
          <button
            className="rail-item rail-calendars"
            aria-label="Schedules"
            aria-haspopup="true"
            onClick={() => setRailCollapsed(false)}
          >
            <CalendarClock size={15} />
            <span className="rail-text">Schedules</span>
          </button>
          <div className="rail-flyout" role="menu" aria-label="Schedules">
            <div className="rail-flyout-head">Schedules</div>
            {schedules.map((schedule) => (
              <div
                className="project-row"
                key={schedule.id}
                data-hidden={schedule.hidden ? "true" : undefined}
              >
                <button
                  className="rail-project"
                  data-hidden={schedule.hidden ? "true" : undefined}
                  role="menuitem"
                  onClick={() => setScheduleEditor(schedule.id)}
                  title={
                    schedule.hidden
                      ? `${schedule.name} (hidden)`
                      : scheduleSummary(schedule, scheduleItems, scheduleBreaks)
                  }
                >
                  <span className="project-dot" style={{ background: schedule.color }} />
                  <span className="rail-text">{schedule.name}</span>
                  <span className="rail-count">{sessionsOf(scheduleItems, schedule.id).length}</span>
                </button>
                <button
                  className="project-delete icon-btn"
                  title="Breaks through the year"
                  onClick={(e) => {
                    e.stopPropagation();
                    setBreaksOverview(schedule.id);
                  }}
                >
                  <CalendarOff size={11} />
                </button>
              </div>
            ))}
            {schedules.length === 0 && <div className="rail-flyout-empty">No schedules yet</div>}
            <div className="menu-sep" />
            <button
              className="rail-flyout-add"
              role="menuitem"
              onClick={() => {
                setRailCollapsed(false);
                setAddingSchedule(true);
              }}
            >
              <Plus size={12} />
              New schedule
            </button>
          </div>
        </div>
      ) : null}

      {collapsed ? null : (
        /* Calendars and schedules grow without limit, so they scroll inside
           the rail instead of pushing Settings off the bottom of the window. */
        <div className="rail-scroll">
          <div className="rail-section">
            <button
              className="rail-section-title"
              onClick={() => setCollectionMenu("calendars")}
              title="Browse calendars"
            >
              Calendars
              <LayoutGrid size={9} className="rail-section-grid" />
            </button>
            <button
              className="icon-btn"
              style={{ width: 20, height: 20 }}
              onClick={() => setAdding((v) => !v)}
              title="New calendar"
            >
              <Plus size={12} />
            </button>
          </div>

          {adding && (
            <div className="rail-project-add">
              <input
                className="input"
                autoFocus
                placeholder="Calendar name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addProject();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setNewName("");
                  }
                }}
                onBlur={() => {
                  if (!newName.trim()) setAdding(false);
                }}
              />
              <button className="btn icon sm" onClick={() => void addProject()} title="Add">
                <Check size={12} />
              </button>
            </div>
          )}

          {projects.map((project, index) => (
            <div
              key={project.id}
              className="project-row"
              data-hidden={project.hidden ? "true" : undefined}
              data-dragging={rowDrag?.kind === "calendar" && rowDrag.index === index}
              data-drop={
                rowDrop?.kind === "calendar" &&
                rowDrop.index === index &&
                rowDrag?.index !== index
              }
              {...rowDragProps("calendar", index)}
              onContextMenu={(e) => openCalendarMenu(e, project.id)}
            >
              <button
                className="rail-project"
                data-active={filterProjectId === project.id}
                onClick={() => pickProject(project)}
                title={project.hidden ? `${project.name} (hidden)` : project.name}
              >
                <span className="project-dot" style={{ background: project.color }} />
                <span className="rail-text">{project.name}</span>
                <span className="rail-count">{projectCounts.get(project.id) ?? 0}</span>
              </button>
              <button
                className="project-hide icon-btn"
                title={project.hidden ? "Show calendar" : "Hide calendar"}
                aria-label={project.hidden ? "Show calendar" : "Hide calendar"}
                aria-pressed={project.hidden ? true : false}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleHidden(project);
                }}
              >
                {project.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
              <button
                className="project-delete icon-btn"
                title="Delete calendar"
                onClick={(e) => {
                  e.stopPropagation();
                  setCalendarDelete(project.id);
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}

          {projects.length === 0 && (
            <div className="faint" style={{ fontSize: "var(--fs-xs)", padding: "4px 10px" }}>
              Calendars group your tasks and color their events.
            </div>
          )}

          <div className="rail-section">
            <button
              className="rail-section-title"
              onClick={() => setCollectionMenu("projects")}
              title="Browse projects"
            >
              Projects
              <LayoutGrid size={9} className="rail-section-grid" />
            </button>
            <button
              className="icon-btn"
              style={{ width: 20, height: 20 }}
              onClick={() => setAddingWorkProject((v) => !v)}
              title="New project"
            >
              <Plus size={12} />
            </button>
          </div>

          {addingWorkProject && (
            <div className="rail-project-add">
              <input
                className="input"
                autoFocus
                placeholder="Project name"
                value={newWorkProjectName}
                onChange={(e) => setNewWorkProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addWorkProject();
                  if (e.key === "Escape") {
                    setAddingWorkProject(false);
                    setNewWorkProjectName("");
                  }
                }}
                onBlur={() => {
                  if (!newWorkProjectName.trim()) setAddingWorkProject(false);
                }}
              />
              <button className="btn icon sm" onClick={() => void addWorkProject()} title="Add">
                <Check size={12} />
              </button>
            </div>
          )}

          {visibleWorkProjects.map((project, index) => (
            <div
              className="project-row"
              key={project.id}
              data-dragging={rowDrag?.kind === "project" && rowDrag.index === index}
              data-drop={
                rowDrop?.kind === "project" &&
                rowDrop.index === index &&
                rowDrag?.index !== index
              }
              {...rowDragProps("project", index)}
              onContextMenu={(event) => openWorkProjectMenu(event, project.id)}
            >
              <button
                className="rail-project"
                data-active={activeView === "projects" && selectedWorkProjectId === project.id}
                onClick={() => pickWorkProject(project)}
                title={project.name}
              >
                <span className="project-dot" style={{ background: project.color }} />
                <span className="rail-text">{project.name}</span>
                <span className="rail-count">
                  {workProjectCounts.get(project.id) ?? 0}
                </span>
              </button>
            </div>
          ))}

          {visibleWorkProjects.length === 0 && (
            <div className="faint" style={{ fontSize: "var(--fs-xs)", padding: "4px 10px" }}>
              Projects plan tasks with dates, dependencies and a team.
            </div>
          )}

          <div className="rail-section">
            <button
              className="rail-section-title"
              onClick={() => setCollectionMenu("schedules")}
              title="Browse schedules"
            >
              Schedules
              <LayoutGrid size={9} className="rail-section-grid" />
            </button>
            <button
              className="icon-btn"
              style={{ width: 20, height: 20 }}
              onClick={() => setAddingSchedule((v) => !v)}
              title="New schedule"
            >
              <Plus size={12} />
            </button>
          </div>

          {addingSchedule && (
            <div className="rail-project-add">
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
                onBlur={() => {
                  if (!newScheduleName.trim()) setAddingSchedule(false);
                }}
              />
              <button className="btn icon sm" onClick={() => void addSchedule()} title="Add">
                <Check size={12} />
              </button>
            </div>
          )}

          {schedules.map((schedule, index) => (
            <div
              className="project-row"
              key={schedule.id}
              data-hidden={schedule.hidden ? "true" : undefined}
              data-dragging={rowDrag?.kind === "schedule" && rowDrag.index === index}
              data-drop={
                rowDrop?.kind === "schedule" &&
                rowDrop.index === index &&
                rowDrag?.index !== index
              }
              {...rowDragProps("schedule", index)}
              onContextMenu={(event) => openScheduleMenu(event, schedule.id)}
            >
              <button
                className="rail-project"
                data-hidden={schedule.hidden ? "true" : undefined}
                onClick={() => setScheduleEditor(schedule.id)}
                title={
                  schedule.hidden
                    ? `${schedule.name} (hidden)`
                    : scheduleSummary(schedule, scheduleItems, scheduleBreaks)
                }
              >
                <span className="project-dot" style={{ background: schedule.color }} />
                <span className="rail-text">{schedule.name}</span>
                <span className="rail-count">{sessionsOf(scheduleItems, schedule.id).length}</span>
              </button>
              <button
                className="project-hide icon-btn"
                title={schedule.hidden ? "Show schedule" : "Hide schedule"}
                aria-label={schedule.hidden ? "Show schedule" : "Hide schedule"}
                aria-pressed={schedule.hidden ? true : false}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleScheduleHidden(schedule);
                }}
              >
                {schedule.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
              <button
                className="project-delete icon-btn"
                title="Breaks through the year"
                onClick={(e) => {
                  e.stopPropagation();
                  setBreaksOverview(schedule.id);
                }}
              >
                <CalendarOff size={11} />
              </button>
            </div>
          ))}

          {schedules.length === 0 && (
            <div className="faint" style={{ fontSize: "var(--fs-xs)", padding: "4px 10px" }}>
              A weekly timetable of classes, with the breaks that interrupt it.
            </div>
          )}

          {/* Tags are the third collection beside calendars and projects.
             The list is a live index: add a tag to any task or event and its
             member count updates in place. */}
          <div className="rail-section rail-tag-section">
            <button
              className="rail-section-title"
              aria-expanded={tagsOpen}
              onClick={() => setTagsOpen((value) => !value)}
              title={tagsOpen ? "Fold tags" : "Unfold tags"}
            >
              <TagIcon size={10} />
              Tags
              <span className="rail-tag-total">{tags.length}</span>
              <ChevronDown
                size={10}
                className="rail-tag-chevron"
                data-open={tagsOpen}
              />
            </button>
          </div>
          <div className="rail-tags" data-open={tagsOpen}>
            <div className="rail-tags-inner">
              {tagUsage.map((entry, index) => (
                <button
                  key={entry.tag.id}
                  className="rail-tag"
                  data-active={activeView === "tasks" && filterTagId === entry.tag.id}
                  style={
                    {
                      "--tag-color": tagColor(entry.tag),
                      animationDelay: `${Math.min(index, 12) * 18}ms`,
                    } as CSSProperties
                  }
                  title={`#${entry.tag.name} · ${entry.tasks.length} ${
                    entry.tasks.length === 1 ? "task" : "tasks"
                  } · ${entry.events.length} ${
                    entry.events.length === 1 ? "event" : "events"
                  } · right-click to edit`}
                  onClick={() => pickTag(entry.tag.id)}
                  onContextMenu={(event) => openTagMenu(event, entry.tag.id)}
                >
                  <span className="rail-tag-hash">#</span>
                  <span className="rail-text">{entry.tag.name}</span>
                  <span className="rail-count">{entry.items.length}</span>
                </button>
              ))}
              {tagUsage.length === 0 && (
                <div className="rail-tag-empty">
                  Tags appear when you add #one to a task or event.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rail-foot">
        <div className="rail-tip-wrap">
          <button
            className="rail-item"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            <Settings size={15} />
            <span className="rail-text">Settings</span>
          </button>
          <span className="rail-tip" aria-hidden>
            Settings
          </span>
        </div>
      </div>

      {!collapsed && (
        <div
          className="rail-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={RAIL_MIN_WIDTH}
          aria-valuemax={RAIL_MAX_WIDTH}
          aria-valuenow={railWidth}
          tabIndex={0}
          title="Drag to resize · double-click to collapse"
          onPointerDown={(e) => {
            e.preventDefault();
            setResizeFrom({ x: e.clientX, width: railWidth });
          }}
          onDoubleClick={toggleRail}
          onKeyDown={(e) => {
            // Global shortcuts also listen on window; resizing must not leak.
            e.stopPropagation();
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setRailWidth(railWidth - 12);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setRailWidth(railWidth + 12);
            }
          }}
        />
      )}
    </aside>
  );
}

/** Small colored dot used by menus and chips. */
export function ColorDot({ color }: { color: string }) {
  return <CircleDot size={11} style={{ color }} />;
}
