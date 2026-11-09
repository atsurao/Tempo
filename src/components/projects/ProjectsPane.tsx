import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Archive,
  ArrowLeft,
  CalendarDays,
  ChartGantt,
  ChevronDown,
  ChevronRight,
  Columns3,
  List,
  Plus,
  RotateCcw,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { Item, TaskDependency, TaskStatus, WorkProject } from "../../types";
import {
  createTaskDependency,
  deleteTaskDependency,
  restoreSubtree,
  softDeleteItem,
  toggleTaskComplete,
  updateItem,
  updateTaskDependency,
  updateWorkProject,
} from "../../db/db";
import {
  useItems,
  useMembers,
  useProjects,
  useTags,
  useTaskDependencies,
  useWorkProjects,
} from "../../db/hooks";
import { useUI } from "../../store/ui";
import { draftFromItem } from "../../lib/draft";
import { isDone, rootTasks } from "../../lib/tasks";
import { projectOverviews, projectSummary } from "../../lib/projects";
import { computeProjectSchedule } from "../../lib/projectSchedule";
import { wouldCreateDependencyCycle } from "../../lib/dependencies";
import { openWorkProjectMenu } from "../../store/contextMenu";
import { TaskBoard } from "../tasks/TaskBoard";
import { TaskList, type TaskGroup } from "../tasks/TaskList";
import { QuickAddBar } from "../tasks/QuickAddBar";
import { ProjectCreateForm } from "./ProjectCreateForm";
import { ProjectGantt } from "./ProjectGantt";

function dayLabel(ts: number | null | undefined): string {
  return ts == null ? "No deadline" : format(ts, "MMM d, yyyy");
}

/**
 * The Projects pane has two levels: an index of every plan, and one plan at a
 * time. Keeping that here rather than in the layout store means a pane can be
 * closed and reopened without inventing a router.
 */
export function ProjectsPane() {
  const projects = useWorkProjects();
  const items = useItems();
  const selectedId = useUI((s) => s.selectedWorkProjectId);
  const live = projects.filter((project) => !project.archivedAt);
  const archived = projects.filter((project) => project.archivedAt);
  const selected = live.find((project) => project.id === selectedId) ?? null;

  if (selected) return <ProjectDetail project={selected} />;
  return <ProjectIndex projects={live} archived={archived} items={items} />;
}

function ProjectIndex({
  projects,
  archived,
  items,
}: {
  projects: WorkProject[];
  archived: WorkProject[];
  items: Item[];
}) {
  const createOpen = useUI((s) => s.projectCreateOpen);
  const setCreateOpen = useUI((s) => s.setProjectCreateOpen);
  const setSelected = useUI((s) => s.setSelectedWorkProject);
  const toast = useUI((s) => s.toast);
  const [showArchived, setShowArchived] = useState(false);
  const overviews = useMemo(() => projectOverviews(projects, items), [projects, items]);
  const showForm = createOpen || projects.length === 0;
  const formRef = useRef<HTMLDivElement>(null);

  /**
   * Clicking out of an optional create form abandons it. With no projects the
   * form is the only way in, so it stays put.
   */
  useEffect(() => {
    if (!createOpen || projects.length === 0) return;
    const onDown = (event: PointerEvent) => {
      if (!formRef.current?.contains(event.target as Node)) setCreateOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [createOpen, projects.length, setCreateOpen]);

  const restore = async (project: WorkProject) => {
    await updateWorkProject(project.id, { archivedAt: null });
    toast(`Restored “${project.name}”`, { tone: "success" });
  };

  return (
    <div className="project-index">
      <div className="project-index-head">
        <div>
          <h1 className="project-index-title">Projects</h1>
          <p className="project-index-sub">
            Plans with dates, working days and a team. Calendars group work; projects plan it.
          </p>
        </div>
        <button
          className="btn sm primary"
          onClick={() => setCreateOpen(!createOpen)}
          disabled={showForm && projects.length === 0}
        >
          <Plus size={11} /> New project
        </button>
      </div>

      <div className="project-form-wrap" ref={formRef}>
        {showForm && (
          <ProjectCreateForm
            onCreated={(project) => setSelected(project.id)}
            onCancel={projects.length > 0 ? () => setCreateOpen(false) : undefined}
          />
        )}
      </div>

      {overviews.length > 0 && (
        <div className="project-grid">
          {overviews.map(({ project, open, done, pct, overdue, nextDue }) => (
            <button
              key={project.id}
              className="project-card"
              onClick={() => {
                setCreateOpen(false);
                setSelected(project.id);
              }}
              onContextMenu={(event) => openWorkProjectMenu(event, project.id)}
              title={`Open ${project.name}`}
            >
              <span className="project-card-rail" style={{ background: project.color }} />
              <span className="project-card-body">
                <span className="project-card-title">{project.name}</span>
                <span className="project-card-meta">
                  <CalendarDays size={10} />
                  {format(project.start, "MMM d")} – {dayLabel(project.deadline)}
                </span>
                <span className="project-progress">
                  <span style={{ width: `${pct}%`, background: project.color }} />
                </span>
                <span className="project-card-foot">
                  <span>
                    {open} open · {done} done
                  </span>
                  {overdue > 0 && (
                    <span className="project-warn">{overdue} overdue</span>
                  )}
                  {nextDue != null && overdue === 0 && (
                    <span className="project-next">next {format(nextDue, "MMM d")}</span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {overviews.length === 0 && !showForm && (
        <div className="empty">
          <strong>No projects yet</strong>
          Create one to plan tasks against a start date, a deadline and a team.
        </div>
      )}

      {archived.length > 0 && (
        <div className="project-archived">
          <button
            className="project-archived-toggle"
            onClick={() => setShowArchived((value) => !value)}
            aria-expanded={showArchived}
          >
            {showArchived ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <Archive size={11} />
            {archived.length} archived {archived.length === 1 ? "project" : "projects"}
          </button>
          {showArchived && (
            <div className="project-archived-rows">
              {archived.map((project) => (
                <div className="project-archived-row" key={project.id}>
                  <span className="project-dot" style={{ background: project.color }} />
                  <span className="project-archived-name">{project.name}</span>
                  <button
                    className="btn sm subtle"
                    title={`Restore ${project.name}`}
                    onClick={() => void restore(project)}
                  >
                    <RotateCcw size={10} /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectDetail({ project }: { project: WorkProject }) {
  const items = useItems();
  const calendars = useProjects();
  const tags = useTags();
  const members = useMembers();
  const dependencies = useTaskDependencies();
  const mode = useUI((s) => s.projectsMode);
  const setMode = useUI((s) => s.setProjectsMode);
  const setSelected = useUI((s) => s.setSelectedWorkProject);
  const openCreate = useUI((s) => s.openCreate);
  const openEdit = useUI((s) => s.openEdit);
  const toast = useUI((s) => s.toast);
  const collapsedGroups = useUI((s) => s.collapsedGroups);
  const toggleGroupCollapsed = useUI((s) => s.toggleGroupCollapsed);
  const setDelegationTask = useUI((s) => s.setDelegationTask);
  const setTeamProject = useUI((s) => s.setTeamProject);

  const tasks = useMemo(
    () => items.filter(
      (item) =>
        item.type === "task" &&
        item.workProjectId === project.id &&
        !item.deletedAt,
    ),
    [items, project.id],
  );
  const team = useMemo(
    () =>
      project.memberIds
        .map((id) => members.find((member) => member.id === id))
        .filter((member): member is NonNullable<typeof member> => Boolean(member)),
    [project.memberIds, members],
  );
  const roots = useMemo(() => rootTasks(tasks), [tasks]);
  const summary = useMemo(() => projectSummary(items, project.id), [items, project.id]);
  const plan = useMemo(
    () => computeProjectSchedule({ project, tasks: items, dependencies }),
    [project, items, dependencies],
  );

  const groups: TaskGroup[] = useMemo(() => {
    const status = (task: Item): TaskStatus =>
      isDone(task) ? "done" : (task.status ?? "todo");
    return (["todo", "doing", "done"] as TaskStatus[])
      .map((value) => ({
        key: `project:${project.id}:${value}`,
        label: value === "todo" ? "To do" : value === "doing" ? "In progress" : "Done",
        color: project.color,
        tasks: roots.filter((task) => status(task) === value),
      }))
      .filter((group) => group.tasks.length > 0);
  }, [roots, project.id, project.color]);

  const statusOfGroup = (key: string | null): TaskStatus => {
    if (!key) return "todo";
    const prefix = `project:${project.id}:`;
    const value = key.startsWith(prefix) ? key.slice(prefix.length) : "todo";
    return value === "done" || value === "doing" ? value : "todo";
  };

  const createTask = (status: TaskStatus = "todo") => {
    openCreate({
      type: "task",
      title: "",
      projectId: project.calendarId ?? null,
      workProjectId: project.id,
      status,
      priority: 0,
    });
  };

  const addSub = (parent: Item) => {
    openCreate({
      type: "task",
      title: "",
      parentId: parent.id,
      projectId: parent.projectId ?? project.calendarId ?? null,
      workProjectId: project.id,
      tagIds: parent.tagIds ?? [],
      priority: parent.priority ?? 0,
    });
  };

  const toggle = async (item: Item) => {
    const result = await toggleTaskComplete(item);
    if (result.nextDue) {
      toast(
        `Repeats — next due ${new Date(result.nextDue).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}`,
      );
    }
  };

  const remove = async (item: Item) => {
    await softDeleteItem(item.id);
    toast(`Deleted “${item.title}”`, {
      actionLabel: "Undo",
      action: () => void restoreSubtree(item.id),
    });
  };

  const openTask = (item: Item) => openEdit(item.id, draftFromItem(item));

  const reschedule = async (
    task: Item,
    dates: { start: number; end: number },
    durationDays?: number,
  ): Promise<void> => {
    const previous = {
      scheduleMode: task.scheduleMode ?? "auto",
      plannedStart: task.plannedStart ?? null,
      plannedEnd: task.plannedEnd ?? null,
      durationDays: task.durationDays ?? null,
    };
    await updateItem(task.id, {
      scheduleMode: "manual",
      plannedStart: dates.start,
      plannedEnd: dates.end,
      ...(durationDays != null ? { durationDays } : {}),
    });
    toast(
      durationDays != null
        ? `Resized “${task.title}” to ${durationDays}d`
        : `Moved “${task.title}” to ${format(dates.start, "MMM d")}`,
      {
        actionLabel: "Undo",
        action: () => void updateItem(task.id, previous),
      },
    );
  };

  /**
   * Reordering the Gantt outline rewrites the order of the moved task and its
   * siblings. Tasks only move among their own siblings, so the tree keeps its
   * shape and a parent can never land inside its own child.
   */
  const reorderTask = (taskId: string, targetId: string, position: "before" | "after") => {
    const task = tasks.find((candidate) => candidate.id === taskId);
    const target = tasks.find((candidate) => candidate.id === targetId);
    if (!task || !target || task.id === target.id) return;
    const parent = task.parentId ?? null;
    if ((target.parentId ?? null) !== parent) return;
    const siblings = tasks
      .filter((candidate) => (candidate.parentId ?? null) === parent)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const without = siblings.filter((candidate) => candidate.id !== taskId);
    const index = without.findIndex((candidate) => candidate.id === targetId);
    if (index < 0) return;
    without.splice(position === "before" ? index : index + 1, 0, task);
    void Promise.all(
      without.map((candidate, order) =>
        candidate.order === order ? Promise.resolve(false) : updateItem(candidate.id, { order }),
      ),
    );
  };

  const linkTasks = async (
    predecessorId: string,
    successorId: string,
  ): Promise<TaskDependency | null> => {
    const projectDependencies = dependencies.filter(
      (dependency) => dependency.workProjectId === project.id,
    );
    if (wouldCreateDependencyCycle(projectDependencies, predecessorId, successorId)) {
      toast("That link would create a loop", { tone: "error" });
      return null;
    }
    const created = await createTaskDependency({
      workProjectId: project.id,
      predecessorId,
      successorId,
    });
    if (!created) {
      toast("That dependency already exists", { tone: "error" });
    }
    return created;
  };

  const editDependency = async (
    id: string,
    patch: { predecessorId?: string; successorId?: string; lagDays?: number },
  ): Promise<boolean> => {
    const current = dependencies.find((dependency) => dependency.id === id);
    if (current) {
      const projectDependencies = dependencies.filter(
        (dependency) => dependency.workProjectId === project.id,
      );
      if (
        wouldCreateDependencyCycle(
          projectDependencies,
          patch.predecessorId ?? current.predecessorId,
          patch.successorId ?? current.successorId,
          id,
        )
      ) {
        toast("That link would create a loop", { tone: "error" });
        return false;
      }
    }
    try {
      await updateTaskDependency(id, patch);
      return true;
    } catch {
      toast("That dependency already exists", { tone: "error" });
      return false;
    }
  };

  const removeDependency = async (dependency: TaskDependency): Promise<void> => {
    await deleteTaskDependency(dependency.id);
    toast("Removed dependency", {
      actionLabel: "Undo",
      action: () =>
        void createTaskDependency({
          workProjectId: dependency.workProjectId,
          predecessorId: dependency.predecessorId,
          successorId: dependency.successorId,
          lagDays: dependency.lagDays,
        }),
    });
  };

  const archive = () => {
    const askConfirm = useUI.getState().askConfirm;
    askConfirm({
      title: `Archive “${project.name}”?`,
      body: "Its tasks stay where they are. You can restore it from the archived list at any time.",
      confirmLabel: "Archive project",
      danger: true,
      onConfirm: () => {
        void (async () => {
          await updateWorkProject(project.id, { archivedAt: Date.now() });
          setSelected(null);
          toast(`Archived “${project.name}”`, {
            actionLabel: "Undo",
            action: () => void updateWorkProject(project.id, { archivedAt: null }),
          });
        })();
      },
    });
  };

  return (
    <div className="project-detail">
      <div className="project-head">
        <button
          className="icon-btn"
          title="All projects"
          aria-label="All projects"
          onClick={() => setSelected(null)}
        >
          <ArrowLeft size={14} />
        </button>
        <span className="project-head-dot" style={{ background: project.color }} />
        <div
          className="project-head-main"
          onContextMenu={(event) => openWorkProjectMenu(event, project.id)}
        >
          <div className="project-head-title">{project.name}</div>
          <div className="project-head-meta">
            <span>{format(project.start, "MMM d, yyyy")} – {dayLabel(project.deadline)}</span>
            <span>·</span>
            <span>{summary.open} open · {summary.done} done</span>
            {plan.finish != null && (
              <>
                <span>·</span>
                <span>plan finishes {format(plan.finish, "MMM d")}</span>
              </>
            )}
            {plan.conflicts.length > 0 && (
              <span className="project-conflict" title={plan.conflicts[0]?.message}>
                <TriangleAlert size={10} /> {plan.conflicts.length}
              </span>
            )}
            {summary.overdue > 0 && (
              <span className="project-warn">{summary.overdue} overdue</span>
            )}
            <button
              className="project-team-pill"
              onClick={() => setTeamProject(project.id)}
              title="Manage the project team"
            >
              <Users size={9} />
              {team.length > 0 ? (
                <span className="project-team-avatars">
                  {team.slice(0, 3).map((member) => (
                    <span
                      className="member-avatar"
                      key={member.id}
                      style={{ background: member.color }}
                      title={member.name}
                    >
                      {member.name.charAt(0).toUpperCase()}
                    </span>
                  ))}
                </span>
              ) : null}
              {team.length === 0 ? "Add team" : `${team.length} on team`}
            </button>
          </div>
        </div>
        <div className="project-tabs seg" role="tablist" aria-label="Project view">
          <button
            data-active={mode === "list"}
            role="tab"
            aria-selected={mode === "list"}
            onClick={() => setMode("list")}
            title="List"
          >
            <List size={11} /> List
          </button>
          <button
            data-active={mode === "board"}
            role="tab"
            aria-selected={mode === "board"}
            onClick={() => setMode("board")}
            title="Board"
          >
            <Columns3 size={11} /> Board
          </button>
          <button
            data-active={mode === "gantt"}
            role="tab"
            aria-selected={mode === "gantt"}
            onClick={() => setMode("gantt")}
            title="Gantt"
          >
            <ChartGantt size={11} /> Gantt
          </button>
        </div>
        <button className="icon-btn" title="New task" onClick={() => createTask("todo")}>
          <Plus size={13} />
        </button>
        <button className="icon-btn" title="Archive project" onClick={archive}>
          <Archive size={13} />
        </button>
      </div>

      <div className="project-progress project-progress-wide">
        <span style={{ width: `${summary.pct}%`, background: project.color }} />
      </div>

      {mode !== "gantt" && (
        <QuickAddBar
          defaults={{ projectId: project.calendarId ?? null, workProjectId: project.id }}
          placeholder={`Add a task to ${project.name}…`}
        />
      )}

      {mode === "gantt" ? (
        <ProjectGantt
          project={project}
          tasks={tasks}
          dependencies={dependencies}
          plan={plan}
          onOpen={openTask}
          onReschedule={reschedule}
          onCreateDependency={linkTasks}
          onUpdateDependency={editDependency}
          onDeleteDependency={removeDependency}
          onReorder={reorderTask}
        />
      ) : mode === "board" ? (
        <TaskBoard
          tasks={roots}
          items={items}
          projects={calendars}
          tags={tags}
          members={members}
          onOpen={openTask}
          onDelegate={(task) => setDelegationTask(task.id)}
          onCreate={createTask}
        />
      ) : (
        <TaskList
          groups={groups}
          items={tasks}
          projects={calendars}
          tags={tags}
          members={members}
          collapsedGroups={collapsedGroups}
          toggleGroupCollapsed={toggleGroupCollapsed}
          onOpen={openTask}
          onToggle={toggle}
          onAddSub={addSub}
          onDelete={remove}
          onDelegate={(task) => setDelegationTask(task.id)}
          onCreate={(key) => createTask(statusOfGroup(key))}
          emptyTitle="No tasks in this project"
          emptyBody="Add one above, or drag a task from the list once it is part of the project."
        />
      )}
    </div>
  );
}
