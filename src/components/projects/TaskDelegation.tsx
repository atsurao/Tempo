import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CalendarDays,
  Check,
  Link2,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Member, TaskDependency, TaskStatus } from "../../types";
import { PALETTE } from "../../types";
import {
  useItems,
  useMembers,
  useTaskDependencies,
  useWorkProjects,
} from "../../db/hooks";
import {
  addProjectMember,
  createMember,
  createTaskDependency,
  deleteTaskDependency,
  removeProjectMember,
  setTaskStatus,
  updateItem,
  updateTaskDependency,
} from "../../db/db";
import { useUI } from "../../store/ui";
import { draftFromItem } from "../../lib/draft";
import { wouldCreateDependencyCycle } from "../../lib/dependencies";
import { completionPct, isDone } from "../../lib/tasks";
import { Select } from "../ui/Select";
import { TabStrip } from "../ui/TabStrip";
import { useIsMobile } from "../../hooks/useIsMobile";

function DependencyRow({
  dependency,
  title,
  side,
  onLag,
  onRemove,
}: {
  dependency: TaskDependency;
  title: string;
  side: "before" | "after";
  onLag: (id: string, lag: number) => Promise<void>;
  onRemove: (dependency: TaskDependency) => Promise<void>;
}) {
  const [lag, setLag] = useState(String(dependency.lagDays));

  useEffect(() => {
    setLag(String(dependency.lagDays));
  }, [dependency.id, dependency.lagDays]);

  const commit = async () => {
    const next = Math.max(0, Math.round(Number(lag) || 0));
    setLag(String(next));
    if (next !== dependency.lagDays) await onLag(dependency.id, next);
  };

  return (
    <div className="dependency-row">
      <span className="dependency-side">{side === "before" ? "after" : "then"}</span>
      <span className="dependency-title">{title || "Untitled"}</span>
      <label className="dependency-lag" title="Lag in working days">
        <input
          value={lag}
          inputMode="numeric"
          aria-label={`Lag after ${title}`}
          onChange={(event) => setLag(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setLag(String(dependency.lagDays));
              event.currentTarget.blur();
            }
          }}
        />
        <span>d</span>
      </label>
      <button
        className="icon-btn"
        title="Remove dependency"
        aria-label="Remove dependency"
        onClick={() => void onRemove(dependency)}
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
}

export function TaskDelegation() {
  const taskId = useUI((s) => s.delegationTaskId);
  const close = () => useUI.getState().setDelegationTask(null);
  const items = useItems();
  const members = useMembers();
  const projects = useWorkProjects();
  const dependencies = useTaskDependencies();
  const toast = useUI((s) => s.toast);
  const openEdit = useUI((s) => s.openEdit);
  const setTeamProject = useUI((s) => s.setTeamProject);

  const task = items.find((item) => item.id === taskId && !item.deletedAt);
  const project = projects.find((candidate) => candidate.id === task?.workProjectId);

  const [progressDraft, setProgressDraft] = useState("0");
  const [newPerson, setNewPerson] = useState("");
  const [busy, setBusy] = useState(false);
  const mobile = useIsMobile();
  const [tab, setTab] = useState<"progress" | "team" | "deps">("progress");

  useEffect(() => {
    if (task) setProgressDraft(String(completionPct(task)));
  }, [task?.id, task?.progressPct, task?.status, task?.completedAt]);

  useEffect(() => {
    if (!taskId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [taskId]);

  const projectTasks = useMemo(
    () =>
      project
        ? items.filter(
            (item) =>
              item.type === "task" &&
              !item.deletedAt &&
              item.workProjectId === project.id,
          )
        : [],
    [items, project],
  );
  const roster = useMemo(
    () =>
      project
        ? project.memberIds
            .map((id) => members.find((member) => member.id === id))
            .filter((member): member is Member => Boolean(member))
        : [],
    [project, members],
  );
  const assigned = useMemo(
    () => (task?.assigneeIds ?? []).map((id) => members.find((member) => member.id === id)).filter(Boolean) as Member[],
    [task?.assigneeIds, members],
  );

  if (!task || !project) return null;

  const links = dependencies.filter(
    (dependency) =>
      dependency.workProjectId === project.id &&
      (dependency.predecessorId === task.id || dependency.successorId === task.id),
  );
  const incoming = links.filter((dependency) => dependency.successorId === task.id);
  const outgoing = links.filter((dependency) => dependency.predecessorId === task.id);
  const titleOf = (id: string) =>
    projectTasks.find((candidate) => candidate.id === id)?.title || "Untitled";

  const commitProgress = async (raw: number) => {
    const pct = Math.max(0, Math.min(100, Math.round(raw)));
    setProgressDraft(String(pct));
    const status: TaskStatus = pct >= 100 ? "done" : pct > 0 ? "doing" : "todo";
    await updateItem(task.id, {
      progressPct: pct,
      status,
      completedAt: pct >= 100 ? (task.completedAt ?? Date.now()) : null,
    });
  };

  const setStatus = async (status: TaskStatus) => {
    await setTaskStatus(task, status);
    setProgressDraft(status === "done" ? "100" : status === "doing" ? "50" : "0");
  };

  const toggleAssignee = async (member: Member) => {
    const current = new Set(task.assigneeIds ?? []);
    if (current.has(member.id)) current.delete(member.id);
    else current.add(member.id);
    await updateItem(task.id, { assigneeIds: [...current] });
  };

  const addPerson = async () => {
    const clean = newPerson.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const existing = members.find(
        (member) => member.name.toLowerCase() === clean.toLowerCase(),
      );
      let member = existing;
      if (!member) {
        member = await createMember({
          name: clean,
          color: PALETTE[members.length % PALETTE.length],
        });
      }
      if (!project.memberIds.includes(member.id)) {
        await addProjectMember(project.id, member.id);
      }
      const current = new Set(task.assigneeIds ?? []);
      current.add(member.id);
      await updateItem(task.id, { assigneeIds: [...current] });
      setNewPerson("");
      toast(`Assigned “${member.name}”`, { tone: "success" });
    } finally {
      setBusy(false);
    }
  };

  const removeFromTeam = async (member: Member) => {
    await removeProjectMember(project.id, member.id);
    toast(`Removed “${member.name}” from the team`, {
      actionLabel: "Undo",
      action: () => void addProjectMember(project.id, member.id),
    });
  };

  const addDependency = async (predecessorId: string, successorId: string) => {
    const projectLinks = dependencies.filter(
      (dependency) => dependency.workProjectId === project.id,
    );
    if (wouldCreateDependencyCycle(projectLinks, predecessorId, successorId)) {
      toast("That link would create a loop", { tone: "error" });
      return;
    }
    const created = await createTaskDependency({
      workProjectId: project.id,
      predecessorId,
      successorId,
    });
    if (!created) {
      toast("That dependency already exists", { tone: "error" });
      return;
    }
    toast("Dependency added", {
      actionLabel: "Undo",
      action: () => void deleteTaskDependency(created.id),
    });
  };

  const removeDependency = async (dependency: TaskDependency) => {
    await deleteTaskDependency(dependency.id);
    toast("Dependency removed", {
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

  const availablePreds = projectTasks.filter(
    (candidate) =>
      candidate.id !== task.id &&
      !incoming.some((dependency) => dependency.predecessorId === candidate.id),
  );
  const availableSuccs = projectTasks.filter(
    (candidate) =>
      candidate.id !== task.id &&
      !outgoing.some((dependency) => dependency.successorId === candidate.id),
  );

  const planned =
    task.plannedStart != null && task.plannedEnd != null
      ? `${format(task.plannedStart, "MMM d")} – ${format(task.plannedEnd, "MMM d")}`
      : "Not scheduled";

  return (
    <div
      className="modal-backdrop delegation-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal delegation-modal" role="dialog" aria-label="Task delegation">
        <div className="modal-head delegation-head">
          <span className="project-head-dot" style={{ background: project.color }} />
          <div className="collection-heading">
            <span className="modal-title">Delegate task</span>
            <span className="collection-hint">
              {project.name} · {task.title || "Untitled"}
            </span>
          </div>
          <span className="spacer" />
          <button className="icon-btn" title="Close" aria-label="Close delegation" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body delegation-body">
          <div className="delegation-summary">
            <span className="delegation-task-title">{task.title || "Untitled"}</span>
            <span className="delegation-summary-meta">
              <CalendarDays size={10} /> {planned}
              {task.durationDays != null && ` · ${task.durationDays}d`}
              {isDone(task) && " · done"}
            </span>
          </div>

          {mobile && (
            <TabStrip
              value={tab}
              onChange={setTab}
              ariaLabel="Delegation sections"
              tabs={[
                { id: "progress", label: "Progress" },
                { id: "team", label: "Team", badge: assigned.length },
                { id: "deps", label: "Dependencies" },
              ]}
            />
          )}

          <div className="delegation-grid">
            <section
              className="delegation-card"
              data-mobile-panel="progress"
              hidden={mobile && tab !== "progress"}
            >
              <div className="delegation-card-head">
                <span>Completion</span>
                <strong>{progressDraft}%</strong>
              </div>
              <div className="delegation-progress">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Number(progressDraft) || 0}
                  aria-label="Completion percentage"
                  onChange={(event) => setProgressDraft(event.target.value)}
                  onPointerUp={() => void commitProgress(Number(progressDraft))}
                  onKeyUp={() => void commitProgress(Number(progressDraft))}
                  style={{ ["--delegation-fill" as string]: `${Number(progressDraft) || 0}%` }}
                />
                <input
                  className="delegation-percent"
                  value={progressDraft}
                  inputMode="numeric"
                  aria-label="Completion percent"
                  onChange={(event) =>
                    setProgressDraft(event.target.value.replace(/[^0-9]/g, "").slice(0, 3))
                  }
                  onBlur={() => void commitProgress(Number(progressDraft))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
                <span>%</span>
              </div>
              <div className="delegation-status seg">
                {(["todo", "doing", "done"] as TaskStatus[]).map((status) => (
                  <button
                    key={status}
                    data-active={isDone(task) ? status === "done" : (task.status ?? "todo") === status}
                    onClick={() => void setStatus(status)}
                  >
                    {status === "todo" ? "To do" : status === "doing" ? "Doing" : "Done"}
                  </button>
                ))}
              </div>
              <label className="delegation-check">
                <input
                  type="checkbox"
                  checked={Boolean(task.milestone)}
                  onChange={(event) => void updateItem(task.id, { milestone: event.target.checked })}
                />
                Milestone
              </label>
            </section>

            <section
              className="delegation-card"
              data-mobile-panel="team"
              hidden={mobile && tab !== "team"}
            >
              <div className="delegation-card-head">
                <span className="row" style={{ gap: 5 }}>
                  <Users size={12} /> Assigned to
                </span>
                <button
                  className="btn sm subtle"
                  onClick={() => {
                    close();
                    setTeamProject(project.id);
                  }}
                >
                  Manage team
                </button>
              </div>

              {roster.length === 0 ? (
                <p className="delegation-empty">
                  No one on this project's team yet. Add someone below.
                </p>
              ) : (
                <div className="assignee-grid">
                  {roster.map((member) => {
                    const selected = Boolean(task.assigneeIds?.includes(member.id));
                    return (
                      <button
                        className="assignee-chip"
                        key={member.id}
                        data-active={selected}
                        aria-pressed={selected}
                        onClick={() => void toggleAssignee(member)}
                        title={selected ? `Unassign ${member.name}` : `Assign ${member.name}`}
                      >
                        <span className="member-avatar" style={{ background: member.color }}>
                          {member.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="assignee-name">
                          {member.name}
                          {member.role && <span className="assignee-role">{member.role}</span>}
                        </span>
                        {selected ? <Check size={11} /> : <Plus size={11} />}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="delegation-add-person">
                <input
                  className="input"
                  placeholder="Add a teammate…"
                  value={newPerson}
                  onChange={(event) => setNewPerson(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void addPerson();
                  }}
                />
                <button
                  className="btn sm"
                  onClick={() => void addPerson()}
                  disabled={!newPerson.trim() || busy}
                >
                  <Plus size={11} /> Add
                </button>
              </div>
              {assigned.length > 0 && (
                <p className="delegation-assigned-note">
                  {assigned.map((member) => member.name).join(", ")} on this task
                </p>
              )}
              {roster.length > 0 && (
                <div className="delegation-roster-links">
                  {roster.map((member) => (
                    <button
                      key={member.id}
                      className="delegation-remove-person"
                      onClick={() => void removeFromTeam(member)}
                      title={`Remove ${member.name} from the project team`}
                    >
                      Remove {member.name}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section
              className="delegation-card delegation-card-wide"
              data-mobile-panel="deps"
              hidden={mobile && tab !== "deps"}
            >
              <div className="delegation-card-head">
                <span className="row" style={{ gap: 5 }}>
                  <Link2 size={12} /> Dependencies
                </span>
                <span className="faint">finish to start · lag in working days</span>
              </div>

              <div className="dependency-list">
                {incoming.length === 0 && outgoing.length === 0 && (
                  <p className="delegation-empty">Nothing blocks this task yet.</p>
                )}
                {incoming.map((dependency) => (
                  <DependencyRow
                    key={dependency.id}
                    dependency={dependency}
                    title={titleOf(dependency.predecessorId)}
                    side="before"
                    onLag={(id, lag) => updateTaskDependency(id, { lagDays: lag })}
                    onRemove={removeDependency}
                  />
                ))}
                {outgoing.map((dependency) => (
                  <DependencyRow
                    key={dependency.id}
                    dependency={dependency}
                    title={titleOf(dependency.successorId)}
                    side="after"
                    onLag={(id, lag) => updateTaskDependency(id, { lagDays: lag })}
                    onRemove={removeDependency}
                  />
                ))}
              </div>

              <div className="dependency-add">
                <label>
                  <span>Blocked by</span>
                  <Select
                    value=""
                    placeholder="Add predecessor…"
                    ariaLabel="Add predecessor task"
                    options={availablePreds.map((candidate) => ({
                      value: candidate.id,
                      label: candidate.title || "Untitled",
                    }))}
                    onChange={(value) => {
                      if (value) void addDependency(value, task.id);
                    }}
                  />
                </label>
                <label>
                  <span>Blocks</span>
                  <Select
                    value=""
                    placeholder="Add successor…"
                    ariaLabel="Add successor task"
                    options={availableSuccs.map((candidate) => ({
                      value: candidate.id,
                      label: candidate.title || "Untitled",
                    }))}
                    onChange={(value) => {
                      if (value) void addDependency(task.id, value);
                    }}
                  />
                </label>
              </div>
            </section>
          </div>
        </div>

        <div className="dlg-foot delegation-foot">
          <span className="faint">Changes save automatically · {assigned.length} assigned</span>
          <span className="spacer" />
          <button
            className="btn sm"
            onClick={() => {
              const current = items.find((item) => item.id === task.id);
              if (current) openEdit(current.id, draftFromItem(current));
              close();
            }}
          >
            Open task editor
          </button>
          <button className="btn sm primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
