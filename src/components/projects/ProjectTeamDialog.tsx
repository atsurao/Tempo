import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2, Users, X } from "lucide-react";
import { PALETTE, type Member } from "../../types";
import { useItems, useMembers, useWorkProjects } from "../../db/hooks";
import {
  addProjectMember,
  createMember,
  removeProjectMember,
} from "../../db/db";
import { useUI } from "../../store/ui";
import { isDone } from "../../lib/tasks";
import { TabStrip } from "../ui/TabStrip";
import { useIsMobile } from "../../hooks/useIsMobile";

/**
 * The roster belongs to the project, not to a task. Managing it here keeps the
 * task delegation card focused on who is doing this piece of work.
 */
export function ProjectTeamDialog() {
  const projectId = useUI((s) => s.teamProjectId);
  const close = () => useUI.getState().setTeamProject(null);
  const projects = useWorkProjects();
  const members = useMembers();
  const items = useItems();
  const toast = useUI((s) => s.toast);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const mobile = useIsMobile();
  const [tab, setTab] = useState<"team" | "add">("team");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    if (!projectId) return;
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [projectId]);

  const project = projects.find((candidate) => candidate.id === projectId);
  const roster = useMemo(
    () =>
      project
        ? project.memberIds
            .map((id) => members.find((member) => member.id === id))
            .filter((member): member is Member => Boolean(member))
        : [],
    [project, members],
  );
  const available = useMemo(
    () => members.filter((member) => !project?.memberIds.includes(member.id)),
    [members, project],
  );

  if (!project) return null;

  const projectTasks = items.filter(
    (item) => !item.deletedAt && item.workProjectId === project.id,
  );

  const addNew = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const member = await createMember({
        name: clean,
        role: role.trim() || undefined,
        color: PALETTE[members.length % PALETTE.length],
      });
      await addProjectMember(project.id, member.id);
      setName("");
      setRole("");
      toast(`Added “${member.name}” to ${project.name}`, { tone: "success" });
    } finally {
      setBusy(false);
    }
  };

  const addExisting = async (member: Member) => {
    await addProjectMember(project.id, member.id);
    toast(`Added “${member.name}” to ${project.name}`);
  };

  const remove = async (member: Member) => {
    await removeProjectMember(project.id, member.id);
    toast(`Removed “${member.name}” from the team`, {
      actionLabel: "Undo",
      action: () => void addProjectMember(project.id, member.id),
    });
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal team-modal" role="dialog" aria-label="Project team">
        <div className="modal-head">
          <span className="project-head-dot" style={{ background: project.color }} />
          <div className="collection-heading">
            <span className="modal-title">{project.name} team</span>
            <span className="collection-hint">
              {roster.length === 0
                ? "Add the people who can take work from this project."
                : `${roster.length} ${roster.length === 1 ? "person" : "people"} on the roster`}
            </span>
          </div>
          <span className="spacer" />
          <button className="icon-btn" title="Close" aria-label="Close team" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body team-body">
          {mobile && (
            <TabStrip
              value={tab}
              onChange={setTab}
              ariaLabel="Team sections"
              tabs={[
                { id: "team", label: "Team", badge: roster.length },
                { id: "add", label: "Add person" },
              ]}
            />
          )}

          <div
            className="team-panel"
            data-mobile-panel="team"
            hidden={mobile && tab !== "team"}
          >
          {roster.length > 0 ? (
            <div className="team-grid">
              {roster.map((member) => {
                const assigned = projectTasks.filter((task) =>
                  task.assigneeIds?.includes(member.id),
                );
                const open = assigned.filter((task) => !isDone(task)).length;
                return (
                  <div className="team-card" key={member.id}>
                    <span className="member-avatar large" style={{ background: member.color }}>
                      {member.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="team-card-main">
                      <span className="team-card-name">{member.name}</span>
                      <span className="team-card-role">{member.role || "Team member"}</span>
                      <span className="team-card-count">
                        {open} open · {assigned.length - open} done
                      </span>
                    </span>
                    <button
                      className="icon-btn team-card-remove"
                      title={`Remove ${member.name} from the team`}
                      aria-label={`Remove ${member.name} from the team`}
                      onClick={() => void remove(member)}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty team-empty">
              <strong>No one on the team yet</strong>
              Add a person below, then assign them from a task's delegation card.
            </div>
          )}

          </div>

          <div
            className="team-panel"
            data-mobile-panel="add"
            hidden={mobile && tab !== "add"}
          >
          {available.length > 0 && (
            <div className="team-available">
              <span className="field-label">Already on this device</span>
              <div className="team-available-row">
                {available.map((member) => (
                  <button
                    className="team-available-chip"
                    key={member.id}
                    onClick={() => void addExisting(member)}
                    title={`Add ${member.name} to ${project.name}`}
                  >
                    <span className="member-avatar" style={{ background: member.color }}>
                      {member.name.charAt(0).toUpperCase()}
                    </span>
                    {member.name}
                    <Plus size={10} />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="team-add">
            <span className="field-label">
              <Users size={11} /> Add someone new
            </span>
            <div className="team-add-row">
              <input
                className="input"
                placeholder="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addNew();
                }}
              />
              <input
                className="input"
                placeholder="Role (optional)"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addNew();
                }}
              />
              <button
                className="btn sm primary"
                onClick={() => void addNew()}
                disabled={!name.trim() || busy}
              >
                <Check size={11} /> Add
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
