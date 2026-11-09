import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Flag,
  Plus,
  Trash2,
  UsersRound,
} from "lucide-react";
import type { Item, Member, Project, Tag } from "../../types";
import { childrenOf, isDone, isOverdue, taskProgress } from "../../lib/tasks";
import { shortDate } from "../../lib/date";
import { clockStamp, clockTime } from "../../lib/clock";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { blocksOf, repeatsBlocks } from "../../lib/timeblocks";
import { openItemMenu, openPostponeMenu } from "../../store/contextMenu";

const PRIORITY_COLOR: Record<number, string> = {
  3: "#e5484d",
  2: "#d97706",
  1: "#8a8a83",
};

interface Props {
  task: Item;
  depth: number;
  items: Item[];
  projects: Project[];
  tags: Tag[];
  members?: Member[];
  collapsed: Set<string>;
  toggleCollapse: (id: string) => void;
  onOpen: (item: Item) => void;
  onToggle: (item: Item) => void;
  onAddSub: (parent: Item) => void;
  onDelete: (item: Item) => void;
  onDelegate?: (item: Item) => void;
  onDragStart?: (e: React.DragEvent, item: Item) => void;
  onDragEnd?: () => void;
  /** False when the row is surfaced from a folded calendar; its subtree stays out of the way. */
  showChildren?: boolean;
}

export function TaskRow({
  task,
  depth,
  items,
  projects,
  tags,
  members,
  collapsed,
  toggleCollapse,
  onOpen,
  onToggle,
  onAddSub,
  onDelete,
  onDelegate,
  onDragStart,
  onDragEnd,
  showChildren = true,
}: Props) {
  const children = useMemo(() => childrenOf(items, task.id), [items, task.id]);
  const progress = useMemo(() => taskProgress(items, task.id), [items, task.id]);
  const done = isDone(task);
  const overdue = isOverdue(task);
  const expanded = !collapsed.has(task.id);
  const taskTags = (task.tagIds ?? [])
    .map((id) => tags.find((tag) => tag.id === id))
    .filter((tag): tag is Tag => Boolean(tag));
  const assigned = (task.assigneeIds ?? [])
    .map((id) => members?.find((member) => member.id === id))
    .filter((member): member is Member => Boolean(member));
  const timeFormat = useTimeFormat();
  const blocks = task.type === "task" ? blocksOf(task) : [];
  const progressLabel =
    progress.total > 1 ? `${progress.done}/${progress.total} · ${progress.pct}%` : `${progress.pct}%`;

  const [completing, setCompleting] = useState(false);
  const completionTimer = useRef<number | null>(null);
  const pendingCompletion = useRef(false);
  const latestToggle = useRef(onToggle);
  latestToggle.current = onToggle;
  const latestTask = useRef(task);
  latestTask.current = task;

  useEffect(
    () => () => {
      if (completionTimer.current == null) return;
      window.clearTimeout(completionTimer.current);
      completionTimer.current = null;
      if (!pendingCompletion.current) return;
      pendingCompletion.current = false;
      // Leaving the view during the exit animation must still complete the
      // task; clearing the timer alone would silently discard the action.
      latestToggle.current(latestTask.current);
    },
    [],
  );

  const toggle = () => {
    if (completing || completionTimer.current != null) return;
    // Let the row visibly leave before the filtered task list drops it. A
    // reopened task stays put, so it does not need the exit animation.
    if (done) {
      onToggle(task);
      return;
    }
    setCompleting(true);
    pendingCompletion.current = true;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    completionTimer.current = window.setTimeout(
      () => {
        completionTimer.current = null;
        pendingCompletion.current = false;
        setCompleting(false);
        onToggle(task);
      },
      reduced ? 0 : 210,
    );
  };

  const dueClass =
    task.dueAt == null || done
      ? ""
      : overdue
        ? "overdue"
        : new Date(task.dueAt).toDateString() === new Date().toDateString()
          ? "today"
          : "";

  return (
    <>
      <div
        className="task-row"
        data-done={done}
        data-overdue={overdue}
        data-completing={completing || undefined}
        draggable={depth === 0}
        onDragStart={(e) => onDragStart?.(e, task)}
        onDragEnd={onDragEnd}
        onDoubleClick={() => onOpen(task)}
        onContextMenu={(e) => openItemMenu(e, task)}
      >
        <button
          className="check"
          data-checked={(progress.pct === 100 && progress.total > 0) || completing}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          title={done ? "Mark not done" : "Mark done"}
          aria-disabled={completing}
        >
          <Check size={10} strokeWidth={3.2} />
        </button>

        {children.length > 0 && showChildren && (
          <button
            className="icon-btn"
            style={{ width: 14, height: 14, marginTop: 2 }}
            onClick={() => toggleCollapse(task.id)}
            title={expanded ? "Collapse subtasks" : "Expand subtasks"}
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        )}

        <div className="task-main" onClick={() => onOpen(task)}>
          <div className="task-title-line">
            <span className="task-title">{task.title || "Untitled"}</span>
            {task.priority ? (
              <Flag size={9.5} style={{ color: PRIORITY_COLOR[task.priority], flex: "none" }} />
            ) : null}
          </div>

          {/* Tags own their row so their left edge never shifts with a due
              date or another piece of metadata. */}
          {taskTags.length > 0 && (
            <div className="task-tags-row">
              {taskTags.slice(0, 4).map((tag) => (
                <span className="tag" key={tag.id} title={`Tagged #${tag.name}`}>
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          <div className="task-meta">
            {task.dueAt != null && (
              <span
                className={`task-due ${dueClass}`}
                title={
                  overdue
                    ? `Overdue · ${clockStamp(task.dueAt, timeFormat, "EEE, MMM d")}`
                    : clockStamp(task.dueAt, timeFormat, "EEE, MMM d")
                }
              >
                <Clock size={9} />
                {shortDate(task.dueAt)}
                {!task.dueAllDay &&
                  new Date(task.dueAt).getHours() !== 23 &&
                  `, ${clockTime(task.dueAt, timeFormat)}`}
              </span>
            )}
            {task.start != null && (
              <span className="task-due" title="First time block on the calendar">
                ◷ {format(task.start, "MMM d")}, {clockTime(task.start, timeFormat)}
                {blocks.length > 1 ? ` · ${blocks.length} blocks` : ""}
              </span>
            )}
            {overdue && (
              <button
                className="postpone-btn"
                title="Change this task's due date"
                onClick={(e) => openPostponeMenu(e, task.id)}
              >
                <CalendarClock size={9} /> Postpone
              </button>
            )}
            {task.estimateMin ? <span>{task.estimateMin}m est.</span> : null}
            {(task.recurrence || repeatsBlocks(task)) && (
              <span title="Repeating time block">↻</span>
            )}
            {assigned.length > 0 && (
              <span className="task-assignees" title={assigned.map((member) => member.name).join(", ")}>
                {assigned.slice(0, 3).map((member) => (
                  <span
                    className="member-avatar"
                    key={member.id}
                    style={{ background: member.color }}
                  >
                    {member.name.charAt(0).toUpperCase()}
                  </span>
                ))}
              </span>
            )}
          </div>

          {(children.length > 0 || progress.pct > 0) && !done && (
            <div className="task-progress-line">
              <div className="task-progress">
                <span style={{ width: `${progress.pct}%` }} />
              </div>
              <span className="task-progress-label">{progressLabel}</span>
            </div>
          )}
        </div>

        <div className="task-actions">
          {onDelegate && (
            <button
              className="icon-btn"
              title="Delegate this task"
              aria-label={`Delegate ${task.title || "untitled task"}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelegate(task);
              }}
            >
              <UsersRound size={11} />
            </button>
          )}
          <button
            className="icon-btn"
            title="Add subtask"
            onClick={(e) => {
              e.stopPropagation();
              onAddSub(task);
            }}
          >
            <Plus size={12} />
          </button>
          <button
            className="icon-btn"
            title="Delete task"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(task);
            }}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {showChildren && expanded && children.length > 0 && (
        <div className="task-subtree">
          {children.map((child) => (
            <TaskRow
              key={child.id}
              task={child}
              depth={depth + 1}
              items={items}
              projects={projects}
              tags={tags}
              members={members}
              onDelegate={onDelegate}
              collapsed={collapsed}
              toggleCollapse={toggleCollapse}
              onOpen={onOpen}
              onToggle={onToggle}
              onAddSub={onAddSub}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </>
  );
}
