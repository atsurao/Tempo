import { useState } from "react";
import { Plus, UsersRound } from "lucide-react";
import type { Item, Member, Project, Tag, TaskStatus } from "../../types";
import { isDone, isOverdue, taskProgress } from "../../lib/tasks";
import { setTaskStatus } from "../../db/db";
import { shortDate } from "../../lib/date";
import { clockStamp, clockTime } from "../../lib/clock";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { DND_TYPE } from "../../lib/draft";
import { openItemMenu, openPostponeMenu } from "../../store/contextMenu";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "doing", label: "In progress" },
  { status: "done", label: "Done" },
];

interface Props {
  tasks: Item[];
  items: Item[];
  projects: Project[];
  tags: Tag[];
  members?: Member[];
  onOpen: (item: Item) => void;
  onDelegate?: (item: Item) => void;
  onCreate: (status: TaskStatus) => void;
}

export function TaskBoard({ tasks, items, projects, tags, members, onOpen, onDelegate, onCreate }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const timeFormat = useTimeFormat();

  return (
    <div className="board">
      {COLUMNS.map((col) => {
        const cards = tasks.filter((t) => {
          const status = isDone(t) ? "done" : (t.status ?? "todo");
          return status === col.status;
        });
        return (
          <div
            key={col.status}
            className="board-col"
            data-over={over === col.status}
            onDragOver={(e) => {
              // The drag state can lag a fast native gesture by a frame, so the
              // payload itself is the source of truth for whether this is ours.
              if (!dragging && !e.dataTransfer.types.includes(DND_TYPE)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(col.status);
            }}
            onDragLeave={() => setOver((o) => (o === col.status ? null : o))}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(DND_TYPE);
              setOver(null);
              setDragging(null);
              if (!id) return;
              e.preventDefault();
              const task = items.find((i) => i.id === id);
              if (task) void setTaskStatus(task, col.status);
            }}
          >
            <div className="board-col-head">
              <span>{col.label}</span>
              <span style={{ opacity: 0.65 }}>{cards.length}</span>
            </div>
            <div className="board-cards">
              {cards.map((card) => {
                const project = projects.find((p) => p.id === card.projectId);
                const progress = taskProgress(items, card.id);
                const overdue = isOverdue(card);
                const cardTags = (card.tagIds ?? [])
                  .map((id) => tags.find((t) => t.id === id))
                  .filter(Boolean) as Tag[];
                return (
                  <div
                    key={card.id}
                    className="board-card"
                    data-dragging={dragging === card.id}
                    data-done={isDone(card)}
                    data-overdue={overdue}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_TYPE, card.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(card.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onClick={() => onOpen(card)}
                    onContextMenu={(e) => openItemMenu(e, card)}
                  >
                    {onDelegate && (
                      <button
                        className="board-card-delegate icon-btn"
                        title="Delegate this task"
                        aria-label={`Delegate ${card.title || "untitled task"}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelegate(card);
                        }}
                      >
                        <UsersRound size={10} />
                      </button>
                    )}
                    <div className="board-card-title">{card.title || "Untitled"}</div>
                    {cardTags.length > 0 && (
                      <div className="board-card-tags">
                        {cardTags.slice(0, 2).map((tag) => (
                          <span className="tag" key={tag.id}>
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {(progress.total > 1 || progress.pct > 0) && (
                      <div className="board-progress-line">
                        <div className="task-progress">
                          <span style={{ width: `${progress.pct}%` }} />
                        </div>
                        <span className="task-progress-label">
                          {progress.total > 1
                            ? `${progress.done}/${progress.total} · ${progress.pct}%`
                            : `${progress.pct}%`}
                        </span>
                      </div>
                    )}
                    <div className="board-card-meta">
                      {card.dueAt != null && (
                        <span
                          className={overdue ? "overdue" : undefined}
                          title={
                            overdue
                              ? `Overdue · ${clockStamp(card.dueAt, timeFormat, "EEE, MMM d")}`
                              : undefined
                          }
                        >
                          {shortDate(card.dueAt)}
                        </span>
                      )}
                      {card.dueAt != null &&
                        !card.dueAllDay &&
                        new Date(card.dueAt).getHours() !== 23 && (
                          <span className={overdue ? "overdue" : undefined}>
                            {clockTime(card.dueAt, timeFormat)}
                          </span>
                        )}
                      {overdue && (
                        <button
                          className="postpone-btn"
                          title="Change this task's due date"
                          onClick={(event) => openPostponeMenu(event, card.id)}
                        >
                          Postpone
                        </button>
                      )}
                      {project && (
                        <span className="row" style={{ gap: 3 }}>
                          <span
                            className="avatar-dot"
                            style={{ background: project.color, width: 5, height: 5 }}
                          />
                          {project.name}
                        </span>
                      )}
                      {(card.assigneeIds ?? []).length > 0 && (
                        <span className="task-assignees" title="Assigned teammates">
                          {(card.assigneeIds ?? []).slice(0, 3).map((id) => {
                            const member = members?.find((candidate) => candidate.id === id);
                            if (!member) return null;
                            return (
                              <span
                                className="member-avatar"
                                key={member.id}
                                style={{ background: member.color }}
                                title={member.name}
                              >
                                {member.name.charAt(0).toUpperCase()}
                              </span>
                            );
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="board-add" onClick={() => onCreate(col.status)}>
              <Plus size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
              Add
            </button>
          </div>
        );
      })}
    </div>
  );
}
