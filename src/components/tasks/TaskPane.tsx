import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Tag as TagIcon, X } from "lucide-react";
import type { Item } from "../../types";
import { useGoals, useItems, useProjects, useTags } from "../../db/hooks";
import { useUI } from "../../store/ui";
import { restoreSubtree, softDeleteItem, toggleTaskComplete } from "../../db/db";
import { isDone, rootTasks } from "../../lib/tasks";
import { draftFromGoal, isGoalDone, sortGoals } from "../../lib/goals";
import { draftFromItem } from "../../lib/draft";
import { buildTagUsage, firstTagName, tagColor, tagMap } from "../../lib/tags";
import { hiddenCalendarIds, hiddenTaskInfo, taskViewRows } from "../../lib/calendars";
import { eod, sod } from "../../lib/date";
import { QuickAddBar } from "./QuickAddBar";
import { TaskBoard } from "./TaskBoard";
import { TaskTimeline } from "./TaskTimeline";
import { HiddenTasksNote } from "./HiddenTasksNote";
import { TaskList } from "./TaskList";
import { TaskViewMenu } from "./TaskViewMenu";

type Filter = "all" | "today" | "upcoming" | "overdue" | "done";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Next 7 days" },
  { id: "overdue", label: "Overdue" },
  { id: "done", label: "Done" },
];

export function TaskPane() {
  const items = useItems();
  const projects = useProjects();
  const tags = useTags();
  const goals = useGoals();
  const openGoalEdit = useUI((s) => s.openGoalEdit);
  const filterProjectId = useUI((s) => s.filterProjectId);
  const setFilterProject = useUI((s) => s.setFilterProject);
  const filterTagId = useUI((s) => s.filterTagId);
  const setFilterTag = useUI((s) => s.setFilterTag);
  const openEdit = useUI((s) => s.openEdit);
  const openCreate = useUI((s) => s.openCreate);
  const tasksMode = useUI((s) => s.tasksMode);
  const keepOverdue = useUI((s) => s.keepOverdue);
  const collapsedGroups = useUI((s) => s.collapsedGroups);
  const toggleGroupCollapsed = useUI((s) => s.toggleGroupCollapsed);
  const toast = useUI((s) => s.toast);
  const taskSort = useUI((s) => s.taskSort);
  const setTaskSort = useUI((s) => s.setTaskSort);

  const [filter, setFilter] = useState<Filter>("all");

  const tagUsage = useMemo(() => buildTagUsage(tags, items), [tags, items]);
  const tagsById = useMemo(() => tagMap(tags), [tags]);
  const activeTag = filterTagId ? tagsById.get(filterTagId) : undefined;

  // Deleting a tag removes it from the list; clear a stale lens with it.
  useEffect(() => {
    if (filterTagId && !tags.some((tag) => tag.id === filterTagId)) setFilterTag(null);
  }, [filterTagId, tags, setFilterTag]);

  const now = Date.now();
  const endToday = eod(now);

  // Hiding reaches the task views too, so a quiet calendar stays quiet here.
  // Filtering to one calendar is an explicit request, though, and shows it even
  // when hidden: a dimmed row in the rail must never dead-end on an empty list.
  const hiddenCalendars = useMemo(() => hiddenCalendarIds(projects), [projects]);
  const sourceItems = useMemo(
    () =>
      taskViewRows(items, hiddenCalendars, filterProjectId ?? (filterTagId ? "tag" : null), {
        keepOverdue,
      }),
    [items, filterProjectId, filterTagId, hiddenCalendars, keepOverdue],
  );
  const sourceGoals = useMemo(
    () => taskViewRows(goals, hiddenCalendars, filterProjectId),
    [goals, filterProjectId, hiddenCalendars],
  );
  const hiddenInfo = useMemo(
    () => hiddenTaskInfo(items, projects, { keepOverdue }),
    [items, projects, keepOverdue],
  );

  // The timeline plots goals alongside tasks, honouring the calendar filter.
  const timelineGoals = useMemo(
    () =>
      filterTagId
        ? []
        : sortGoals(
            sourceGoals.filter(
              (g) =>
                !g.deletedAt &&
                !isGoalDone(g) &&
                (!filterProjectId || g.projectId === filterProjectId),
            ),
          ),
    [sourceGoals, filterProjectId, filterTagId],
  );

  const filtered = useMemo(() => {
    // A tag is a flat collection: a tagged subtask is just as much a member as
    // its parent, and it should be visible even when the parent is untagged.
    const rows = filterTagId
      ? sourceItems.filter(
          (item) =>
            item.type === "task" &&
            !item.deletedAt &&
            (item.tagIds ?? []).includes(filterTagId),
        )
      : rootTasks(sourceItems);
    // The board is a status board: finished cards belong in its Done column
    // instead of disappearing the moment they are completed.
    const keepDone = tasksMode === "board" && filter !== "done";
    return rows.filter((task) => {
      if (filterTagId && !(task.tagIds ?? []).includes(filterTagId)) return false;
      if (filterProjectId && task.projectId !== filterProjectId) return false;
      if (filter === "done") return isDone(task);
      if (isDone(task) && !keepDone) return false;
      if (filter === "today") return task.dueAt != null && task.dueAt <= endToday;
      if (filter === "upcoming")
        return (
          task.dueAt != null &&
          task.dueAt >= sod(now) &&
          task.dueAt < now + 7 * 86_400_000
        );
      if (filter === "overdue") return task.dueAt != null && task.dueAt < now;
      return true;
    });
  }, [sourceItems, filter, filterProjectId, filterTagId, endToday, now, tasksMode]);

  const ordered = useMemo(() => {
    const list = [...filtered];
    const due = (task: Item) => task.dueAt ?? Number.POSITIVE_INFINITY;
    switch (taskSort) {
      case "due":
        return list.sort((a, b) => due(a) - due(b) || a.title.localeCompare(b.title));
      case "priority":
        return list.sort(
          (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || due(a) - due(b),
        );
      case "tag":
        return list.sort(
          (a, b) =>
            firstTagName(a, tagsById).localeCompare(firstTagName(b, tagsById)) ||
            due(a) - due(b) ||
            (a.title || "Untitled").localeCompare(b.title || "Untitled"),
        );
      case "title":
        return list.sort((a, b) =>
          (a.title || "Untitled").localeCompare(b.title || "Untitled"),
        );
      case "created":
        return list.sort((a, b) => b.createdAt - a.createdAt);
      default:
        return list;
    }
  }, [filtered, taskSort, tagsById]);

  const groups = useMemo(() => {
    if (filterProjectId) {
      const project = projects.find((p) => p.id === filterProjectId);
      return [
        {
          key: filterProjectId,
          label: project?.name ?? "Calendar",
          color: project?.color ?? "var(--accent-ink)",
          tasks: ordered,
        },
      ];
    }
    const order = [...projects].sort((a, b) => a.order - b.order);
    const result = order
      .map((project) => ({
        key: project.id,
        label: project.name,
        color: project.color,
        tasks: ordered.filter((t) => t.projectId === project.id),
      }))
      .filter((g) => g.tasks.length > 0);
    const loose = ordered.filter((t) => !t.projectId || !projects.some((p) => p.id === t.projectId));
    if (loose.length > 0) {
      result.push({ key: "none", label: "No calendar", color: "var(--text-3)", tasks: loose });
    }
    return result;
  }, [ordered, filterProjectId, projects]);

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
      // restoreSubtree puts back every level that the cascade removed.
      action: () => void restoreSubtree(item.id),
    });
  };

  const addSub = (parent: Item) => {
    openCreate({
      type: "task",
      title: "",
      parentId: parent.id,
      projectId: parent.projectId ?? null,
      workProjectId: parent.workProjectId ?? null,
      tagIds: parent.tagIds ?? [],
      priority: parent.priority ?? 0,
    });
  };

  const createInGroup = (projectId: string | null, status?: Item["status"]) => {
    openCreate({
      type: "task",
      title: "",
      projectId,
      status: status ?? "todo",
      priority: 0,
      tagIds: filterTagId ? [filterTagId] : [],
    });
  };

  const openTask = (item: Item) => openEdit(item.id, draftFromItem(item));

  return (
    <div className="tasks">
      <QuickAddBar
        defaults={{
          projectId: filterProjectId ?? null,
          tagIds: filterTagId ? [filterTagId] : undefined,
        }}
        placeholder={
          filterProjectId
            ? `Add to ${projects.find((p) => p.id === filterProjectId)?.name ?? "calendar"}…`
            : "Add a task…  read ch. 4 fri 2pm #reading !2"
        }
      />

      <div className="tasks-toolbar">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className="filter-chip"
            data-active={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        {filterProjectId && (
          <button
            className="filter-chip"
            onClick={() => setFilterProject(null)}
            title="Clear calendar filter"
          >
            <span className="row" style={{ gap: 4 }}>
              <X size={10} /> {projects.find((p) => p.id === filterProjectId)?.name ?? "calendar"}
            </span>
          </button>
        )}
        {activeTag && (
          <button
            className="filter-chip filter-chip-tag"
            data-active="true"
            onClick={() => setFilterTag(null)}
            title="Clear tag filter"
            style={{ "--tag-color": tagColor(activeTag) } as CSSProperties}
          >
            <TagIcon size={10} />#{activeTag.name}
            <X size={9} />
          </button>
        )}
        <span className="spacer" />
        <TaskViewMenu
          sort={taskSort}
          onSort={setTaskSort}
          tags={tagUsage}
          tagId={filterTagId}
          onTag={setFilterTag}
        />
      </div>

      {/* An explicit calendar filter already shows its tasks, so there is
          nothing suppressed to report. */}
      {!filterProjectId && !filterTagId && (
        <HiddenTasksNote count={hiddenInfo.count} calendars={hiddenInfo.calendars} />
      )}

      {tasksMode === "board" ? (
        <TaskBoard
          tasks={filtered}
          items={items}
          projects={projects}
          tags={tags}
          onOpen={openTask}
          onCreate={(status) => createInGroup(filterProjectId ?? null, status)}
        />
      ) : tasksMode === "timeline" ? (
        <TaskTimeline
          tasks={filtered}
          goals={timelineGoals}
          projects={projects}
          onOpen={openTask}
          onOpenGoal={(goal) => openGoalEdit(goal.id, draftFromGoal(goal))}
        />
      ) : (
        <TaskList
          key={`${filter}-${filterTagId ?? "all"}-${filterProjectId ?? "all"}`}
          groups={groups}
          items={sourceItems}
          projects={projects}
          tags={tags}
          collapsedGroups={collapsedGroups}
          toggleGroupCollapsed={toggleGroupCollapsed}
          onOpen={openTask}
          onToggle={toggle}
          onAddSub={addSub}
          onDelete={remove}
          onCreate={(groupKey) => createInGroup(groupKey)}
          flat={filterTagId != null}
          emptyTitle={
            filterTagId
              ? `No tasks tagged #${activeTag?.name ?? "tag"}`
              : filter === "done"
                ? "Nothing completed yet"
                : "You're all clear"
          }
          emptyBody={
            filterTagId
              ? "Tag a task with it, or add one above; new tasks join this tag automatically."
              : filter === "overdue"
                ? "No overdue work. Keep it that way."
                : "Add a task above, or drag one onto the calendar to block time for it."
          }
        />
      )}
    </div>
  );
}
