import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { Item, Member, Project, Tag } from "../../types";
import { isOverdue } from "../../lib/tasks";
import { DND_TYPE } from "../../lib/draft";
import { TaskRow } from "./TaskRow";

export interface TaskGroup {
  key: string;
  label: string;
  color: string;
  tasks: Item[];
}

interface Props {
  groups: TaskGroup[];
  /** Every visible task, so subtasks can be found from their parent row. */
  items: Item[];
  projects: Project[];
  tags: Tag[];
  members?: Member[];
  collapsedGroups: string[];
  toggleGroupCollapsed: (key: string) => void;
  onOpen: (item: Item) => void;
  onToggle: (item: Item) => void;
  onAddSub: (parent: Item) => void;
  onDelete: (item: Item) => void;
  onDelegate?: (item: Item) => void;
  /** A group key, or null for an ungrouped add. */
  onCreate: (groupKey: string | null) => void;
  emptyTitle: string;
  emptyBody: string;
  /** Tag results are a flat collection, not a tree of untagged siblings. */
  flat?: boolean;
}

/**
 * The list body shared by Tasks and a project. It owns only the presentation
 * state that belongs to a list — which subtask trees are folded and which row
 * is being dragged — while the surrounding page decides what the groups are.
 */
export function TaskList({
  groups,
  items,
  projects,
  tags,
  members,
  collapsedGroups,
  toggleGroupCollapsed,
  onOpen,
  onToggle,
  onAddSub,
  onDelete,
  onDelegate,
  onCreate,
  emptyTitle,
  emptyBody,
  flat = false,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);

  const toggleSubtree = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="tasks-scroll">
      {groups.length === 0 && (
        <div className="empty">
          <strong>{emptyTitle}</strong>
          {emptyBody}
        </div>
      )}

      {groups.map((group) => {
        const folded = collapsedGroups.includes(group.key);
        // A folded group still surfaces its overdue work, with the rest
        // counted underneath so nothing past due disappears from sight.
        const visible = folded ? group.tasks.filter((t) => isOverdue(t)) : group.tasks;
        const hidden = folded ? group.tasks.length - visible.length : 0;

        return (
          <div className="task-group" key={group.key} data-collapsed={folded}>
            <div className="task-group-head">
              <button
                className="group-toggle"
                aria-expanded={!folded}
                title={folded ? `Expand ${group.label}` : `Collapse ${group.label}`}
                onClick={() => toggleGroupCollapsed(group.key)}
              >
                <span className="group-chevron">
                  {folded ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                </span>
                <span className="avatar-dot" style={{ background: group.color }} />
                <span className="group-name">{group.label}</span>
                <span className="group-count">{group.tasks.length}</span>
              </button>
              <span style={{ flex: 1 }} />
              <button
                className="icon-btn"
                style={{ width: 18, height: 18 }}
                title={`Add task to ${group.label}`}
                onClick={() => {
                  // Don't drop a new task into a group the user can't see.
                  if (folded) toggleGroupCollapsed(group.key);
                  onCreate(group.key === "none" ? null : group.key);
                }}
              >
                <Plus size={11} />
              </button>
            </div>

            {visible.map((task) => (
              <div
                key={task.id}
                data-overflow={folded}
                data-drop={dragging === task.id}
                onDragOver={(e) => {
                  if (!dragging || dragging === task.id) return;
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(null);
                }}
              >
                <TaskRow
                  task={task}
                  depth={0}
                  items={items}
                  projects={projects}
                  tags={tags}
                  members={members}
                  onDelegate={onDelegate}
                  collapsed={collapsed}
                  showChildren={!flat && !folded}
                  toggleCollapse={toggleSubtree}
                  onOpen={onOpen}
                  onToggle={onToggle}
                  onAddSub={onAddSub}
                  onDelete={onDelete}
                  onDragStart={(e, item) => {
                    e.dataTransfer.setData(DND_TYPE, item.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(item.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                />
              </div>
            ))}

            {folded && visible.length > 0 && hidden > 0 && (
              <button
                className="group-more"
                title={`Expand ${group.label}`}
                onClick={() => toggleGroupCollapsed(group.key)}
              >
                {hidden} more hidden
                <ChevronDown size={10} />
              </button>
            )}

            {!folded && (
              <button
                className="task-add-row"
                onClick={() => onCreate(group.key === "none" ? null : group.key)}
              >
                <Plus size={11} /> Add task
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
