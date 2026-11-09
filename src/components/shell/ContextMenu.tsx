import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Archive,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  ListTodo,
  MapPin,
  Pencil,
  Repeat,
  RotateCcw,
  Settings2,
  Sun,
  Tag as TagIcon,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Item, Occurrence } from "../../types";
import { PALETTE, PRIORITY_LABEL } from "../../types";
import {
  useItems,
  useMembers,
  useProjects,
  useScheduleBreaks,
  useScheduleExceptions,
  useScheduleItems,
  useSchedules,
  useTags,
  useWorkProjects,
} from "../../db/hooks";
import {
  cancelOccurrence,
  deleteScheduleOccurrence,
  duplicateItem,
  deleteTag,
  purgeItem,
  removeScheduleException,
  saveScheduleException,
  restoreSubtree,
  softDeleteItem,
  toggleTaskComplete,
  updateProject,
  updateSchedule,
  updateTag,
  updateWorkProject,
} from "../../db/db";
import { useUI } from "../../store/ui";
import { useOpenView } from "../../store/nav";
import { draftFromItem } from "../../lib/draft";
import { isDone, isOverdue, masterOf } from "../../lib/tasks";
import { repeatsBlocks } from "../../lib/timeblocks";
import { tagColor } from "../../lib/tags";
import { sessionsOf } from "../../lib/schedule";
import { nextCalendarDate, nextScheduleDate } from "../../lib/collectionFocus";
import { clockTime, type TimeFormat } from "../../lib/clock";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { useIsMobile } from "../../hooks/useIsMobile";
import { SheetDragHandle } from "../ui/SheetDragHandle";
import { eod, sod } from "../../lib/date";

const TYPE_META = {
  event: { label: "Event", icon: CalendarDays },
  task: { label: "Task", icon: CheckSquare },
  note: { label: "Note", icon: FileText },
} as const;

function whenLabel(
  item: Item,
  menu: { start?: number; end?: number },
  style: TimeFormat,
): string | null {
  if (menu.start != null) {
    const end = menu.end ?? menu.start;
    if (item.allDay) return `${format(menu.start, "EEE, MMM d")} · All day`;
    const sameDay = new Date(menu.start).toDateString() === new Date(end).toDateString();
    return `${format(menu.start, "EEE, MMM d")} · ${clockTime(menu.start, style)} – ${
      sameDay ? clockTime(end, style) : `${format(end, "EEE, MMM d")}, ${clockTime(end, style)}`
    }`;
  }
  if (item.dueAt != null) {
    const due = new Date(item.dueAt);
    const dateOnly = item.dueAllDay || (due.getHours() === 23 && due.getMinutes() === 59);
    const day = format(item.dueAt, "EEE, MMM d");
    return `Due ${dateOnly ? day : `${day} · ${clockTime(item.dueAt, style)}`}`;
  }
  return null;
}

export function ContextMenu() {
  const menu = useUI((s) => s.contextMenu);
  const timeFormat = useTimeFormat();
  const close = useUI((s) => s.closeContextMenu);
  const askConfirm = useUI((s) => s.askConfirm);
  const filterTagId = useUI((s) => s.filterTagId);
  const setFilterTag = useUI((s) => s.setFilterTag);
  const items = useItems();
  const projects = useProjects();
  const tags = useTags();
  const workProjects = useWorkProjects();
  const schedules = useSchedules();
  const scheduleItems = useScheduleItems();
  const scheduleBreaks = useScheduleBreaks();
  const scheduleExceptions = useScheduleExceptions();
  const members = useMembers();
  const openEdit = useUI((s) => s.openEdit);
  const openPostpone = useUI((s) => s.openPostponeMenu);
  const toast = useUI((s) => s.toast);
  const setCalendarSettings = useUI((s) => s.setCalendarSettings);
  const setCalendarDelete = useUI((s) => s.setCalendarDelete);
  const setFilterProject = useUI((s) => s.setFilterProject);
  const setCollectionMenu = useUI((s) => s.setCollectionMenu);
  const setSelectedWorkProject = useUI((s) => s.setSelectedWorkProject);
  const setProjectCreateOpen = useUI((s) => s.setProjectCreateOpen);
  const setTeamProject = useUI((s) => s.setTeamProject);
  const setDelegationTask = useUI((s) => s.setDelegationTask);
  const setScheduleEditor = useUI((s) => s.setScheduleEditor);
  const setScheduleDelete = useUI((s) => s.setScheduleDelete);
  const setScheduleOccurrence = useUI((s) => s.setScheduleOccurrence);
  const setBreaksOverview = useUI((s) => s.setBreaksOverview);
  const setAnchor = useUI((s) => s.setAnchor);
  const setCalendarMode = useUI((s) => s.setCalendarMode);
  const highlightCollection = useUI((s) => s.highlightCollection);
  const openView = useOpenView();

  const revealCalendar = (projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    const focus = nextCalendarDate(items, project.id);
    if (project.hidden) void updateProject(project.id, { hidden: false });
    if (focus != null) setAnchor(focus);
    setCalendarMode("week");
    setFilterProject(null);
    setCollectionMenu(null);
    highlightCollection("calendar", project.id);
    openView("calendar", { keepCalendarAnchor: true });
    toast(`Highlighting “${project.name}”`);
  };

  const revealSchedule = (scheduleId: string) => {
    const schedule = schedules.find((candidate) => candidate.id === scheduleId);
    if (!schedule) return;
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
    setCollectionMenu(null);
    highlightCollection("schedule", schedule.id);
    openView("calendar", { keepCalendarAnchor: true });
    toast(`Highlighting “${schedule.name}”`);
  };

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const mobile = useIsMobile();
  const [page, setPage] = useState<"main" | "more">("main");
  const [renamingTag, setRenamingTag] = useState(false);
  const [tagName, setTagName] = useState("");
  const sheetHandle = (
    <SheetDragHandle sheetRef={ref} enabled={mobile} onDismiss={close} />
  );

  // A fresh menu always starts on its first page with its tag editor closed.
  useEffect(() => {
    setPage("main");
    setRenamingTag(false);
  }, [menu]);

  // Measure once mounted, then clamp against the viewport so a right click near
  // an edge still opens the whole menu on screen.
  useLayoutEffect(() => {
    if (!menu) {
      setPos(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    // Layout size, not the animated rect: the entry animation scales the box
    // down, which would let the clamped menu grow past the viewport edge.
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = Math.min(Math.max(8, menu.x), Math.max(8, window.innerWidth - width - 8));
    const top =
      menu.y + height + 8 > window.innerHeight
        ? Math.max(8, window.innerHeight - height - 8)
        : menu.y;
    setPos({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    // The phone shell's scrim owns outside taps. Dismissing on pointerdown
    // would remove it before the click, which WebKit can deliver to the day
    // grid underneath — reopening the slot menu.
    const onPointerDown = (e: PointerEvent) => {
      if (mobile) return;
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The inline tag rename field owns Escape: cancel the edit, not the menu.
      if (e.target instanceof HTMLInputElement && ref.current?.contains(e.target)) return;
      e.stopPropagation();
      close();
    };
    // On a phone the bottom sheet is dismissed by its scrim. Keep it open
    // while the software keyboard changes the viewport or scrolls the page;
    // otherwise focusing the tag rename field closes the editor immediately.
    const onScroll = (e: Event) => {
      if (mobile) return;
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onResize = () => {
      if (!mobile) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [menu, close, mobile]);

  if (!menu) return null;

  // Empty calendar space: the pointer already names the time, so every action
  // here uses it rather than asking for it again.
  if (menu.kind === "slot") {
    const start = menu.start ?? Date.now();
    const dayStart = sod(start);
    const allDay = Boolean(menu.allDay);
    const label = allDay
      ? format(start, "EEEE, MMM d")
      : `${format(start, "EEE, MMM d")} · ${clockTime(start, timeFormat)}`;
    const createEvent = () => {
      const from = allDay ? dayStart + 9 * 3_600_000 : start;
      useUI.getState().openCreate({
        type: "event",
        title: "",
        start: from,
        end: from + 3_600_000,
      });
      close();
    };
    const createTask = () => {
      useUI.getState().openCreate({
        type: "task",
        title: "",
        priority: 0,
        dueAt: allDay ? eod(dayStart) : start,
        dueAllDay: allDay,
      });
      close();
    };
    return (
      <div
        ref={ref}
        className="ctx ctx-slot"
        role="menu"
        aria-label="Calendar slot actions"
        style={{
          left: pos?.left ?? menu.x,
          top: pos?.top ?? menu.y,
          visibility: pos ? "visible" : "hidden",
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {sheetHandle}
        <div className="ctx-head">
          <Clock size={11} />
          <span className="ctx-name">{label}</span>
        </div>
        <button className="ctx-item" role="menuitem" onClick={createEvent}>
          <CalendarDays size={13} /> New event
        </button>
        <button className="ctx-item" role="menuitem" onClick={createTask}>
          <ListTodo size={13} /> New task {allDay ? "due that day" : "due then"}
        </button>
        <div className="ctx-sep" />
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            setAnchor(dayStart);
            close();
          }}
        >
          <Sun size={13} /> Go to this day
        </button>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            setAnchor(dayStart);
            setCalendarMode("day");
            close();
          }}
        >
          <CalendarDays size={13} /> Open day view
        </button>
      </div>
    );
  }

  if (menu.kind === "tag") {
    const tag = tags.find((candidate) => candidate.id === menu.tagId);
    if (!tag) return null;
    const members = items.filter(
      (item) => !item.deletedAt && !item.cancelled && item.tagIds?.includes(tag.id),
    );
    const taskCount = members.filter((item) => item.type === "task").length;
    const eventCount = members.filter((item) => item.type === "event").length;
    const color = tagColor(tag);

    const commitName = () => {
      const name = tagName.trim().replace(/^#/, "");
      if (!name || name === tag.name) {
        setRenamingTag(false);
        return;
      }
      if (
        tags.some(
          (candidate) =>
            candidate.id !== tag.id &&
            candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      ) {
        toast(`A tag named “${name}” already exists.`);
        return;
      }
      void updateTag(tag.id, { name }).then(() => {
        setRenamingTag(false);
        close();
      });
    };

    const remove = () => {
      askConfirm({
        title: `Delete “#${tag.name}”?`,
        body: "The tag will be removed from every task and event. The tasks and events themselves will stay.",
        confirmLabel: "Delete tag",
        danger: true,
        onConfirm: () => {
          if (filterTagId === tag.id) setFilterTag(null);
          void deleteTag(tag.id).then(() =>
            toast(`Deleted tag “#${tag.name}”`),
          );
        },
      });
      close();
    };

    return (
      <div
        ref={ref}
        className="ctx ctx-tag"
        role="menu"
        aria-label={`#${tag.name} actions`}
        style={{
          left: pos?.left ?? menu.x,
          top: pos?.top ?? menu.y,
          visibility: pos ? "visible" : "hidden",
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {sheetHandle}
        <div className="ctx-head">
          <span className="ctx-dot" style={{ background: color }} />
          <TagIcon size={11} />
          <span className="ctx-name">{tag.name}</span>
          <span className="ctx-count">
            {members.length} {members.length === 1 ? "item" : "items"}
          </span>
        </div>

        {renamingTag ? (
          <div className="ctx-rename">
            <span className="ctx-rename-hash">#</span>
            <input
              className="input"
              autoFocus
              value={tagName}
              placeholder="Tag name"
              onChange={(event) => setTagName(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitName();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setRenamingTag(false);
                }
              }}
            />
            <button className="btn icon sm" title="Save name" onClick={commitName}>
              <Check size={12} />
            </button>
            <button
              className="btn icon sm"
              title="Cancel rename"
              onClick={() => setRenamingTag(false)}
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            className="ctx-item"
            role="menuitem"
            onClick={() => {
              setTagName(tag.name);
              setRenamingTag(true);
            }}
          >
            <Pencil size={13} /> Rename…
          </button>
        )}

        <div className="ctx-sep" />
        <div className="ctx-label">Color</div>
        <div className="ctx-swatches">
          {PALETTE.map((swatch) => (
            <button
              key={swatch}
              className="ctx-swatch"
              style={{ background: swatch }}
              data-active={tagColor(tag) === swatch}
              title={swatch}
              aria-label={`Use ${swatch}`}
              onClick={() => {
                void updateTag(tag.id, { color: swatch });
                close();
              }}
            />
          ))}
        </div>
        <div className="ctx-tag-summary">
          {taskCount} {taskCount === 1 ? "task" : "tasks"} · {eventCount}{" "}
          {eventCount === 1 ? "event" : "events"}
        </div>

        <div className="ctx-sep" />
        <button className="ctx-item danger" role="menuitem" onClick={remove}>
          <Trash2 size={13} /> Delete tag…
        </button>
      </div>
    );
  }

  if (menu.kind === "calendar") {
    const project = projects.find((p) => p.id === menu.projectId);
    if (!project) return null;
    const open = items.filter(
      (i) => i.type === "task" && !i.deletedAt && !isDone(i) && i.projectId === project.id,
    ).length;
    return (
      <div
        ref={ref}
        className="ctx ctx-calendar"
        role="menu"
        aria-label={`${project.name} actions`}
        style={{
          left: pos?.left ?? menu.x,
          top: pos?.top ?? menu.y,
          visibility: pos ? "visible" : "hidden",
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {sheetHandle}
        <div className="ctx-head">
          <span className="ctx-dot" style={{ background: project.color }} />
          <span className="ctx-name">{project.name}</span>
          <span className="ctx-count">{open} open</span>
        </div>

        {mobile && page === "more" && (
          <button className="ctx-item ctx-back" onClick={() => setPage("main")}>
            <ChevronLeft size={13} /> Back
          </button>
        )}

        {(!mobile || page === "main") && (
          <>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            revealCalendar(project.id);
            close();
          }}
        >
          <CalendarDays size={13} /> Show on calendar
        </button>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            setFilterProject(project.id);
            openView("tasks");
            close();
          }}
        >
          <ListTodo size={13} /> Show tasks
        </button>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            const hidden = !project.hidden;
            void updateProject(project.id, { hidden });
            toast(hidden ? `Hidden “${project.name}”` : `Showing “${project.name}”`, {
              actionLabel: "Undo",
              action: () => void updateProject(project.id, { hidden: !hidden }),
            });
            close();
          }}
        >
          {project.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          {project.hidden ? "Show calendar" : "Hide calendar"}
        </button>

        {mobile && (
          <button className="ctx-item ctx-more" onClick={() => setPage("more")}>
            <Settings2 size={13} /> More actions
            <ChevronRight size={13} className="ctx-chevron" />
          </button>
        )}
          </>
        )}

        {(!mobile || page === "more") && (
          <>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            setCalendarSettings(project.id);
            close();
          }}
        >
          <Settings2 size={13} /> Calendar settings…
        </button>

        <div className="ctx-sep" />
        <div className="ctx-label">Color</div>
        <div className="ctx-swatches">
          {PALETTE.map((color) => (
            <button
              key={color}
              className="ctx-swatch"
              style={{ background: color }}
              data-active={project.color === color}
              title={color}
              aria-label={`Use ${color}`}
              onClick={() => {
                void updateProject(project.id, { color });
                close();
              }}
            />
          ))}
        </div>

        <div className="ctx-sep" />
        <button
          className="ctx-item danger"
          role="menuitem"
          onClick={() => {
            setCalendarDelete(project.id);
            close();
          }}
        >
          <Trash2 size={13} /> Delete calendar…
        </button>
          </>
        )}
      </div>
    );
  }

  if (menu.kind === "workProject") {
    const project = workProjects.find((candidate) => candidate.id === menu.workProjectId);
    if (!project) return null;
    const projectTasks = items.filter(
      (candidate) =>
        candidate.type === "task" &&
        !candidate.deletedAt &&
        candidate.workProjectId === project.id,
    );
    const open = projectTasks.filter((task) => !isDone(task)).length;
    const roster = project.memberIds
      .map((id) => members.find((member) => member.id === id))
      .filter((member): member is NonNullable<typeof member> => Boolean(member));
    return (
      <div
        ref={ref}
        className="ctx ctx-calendar"
        role="menu"
        aria-label={`${project.name} actions`}
        style={{
          left: pos?.left ?? menu.x,
          top: pos?.top ?? menu.y,
          visibility: pos ? "visible" : "hidden",
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {sheetHandle}
        <div className="ctx-head">
          <span className="ctx-dot" style={{ background: project.color }} />
          <span className="ctx-name">{project.name}</span>
          <span className="ctx-count">{open} open</span>
        </div>        {mobile && page === "more" && (
          <button className="ctx-item ctx-back" onClick={() => setPage("main")}>
            <ChevronLeft size={13} /> Back
          </button>
        )}

        {(!mobile || page === "main") && (
          <>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            setProjectCreateOpen(false);
            setSelectedWorkProject(project.id);
            openView("projects");
            close();
          }}

        >
          <FolderKanban size={13} /> Open project
        </button>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            useUI.getState().openProjectEdit(project.id);
            close();
          }}
        >
          <Settings2 size={13} /> Edit project…
        </button>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            useUI.getState().openCreate({
              type: "task",
              title: "",
              projectId: project.calendarId ?? null,
              workProjectId: project.id,
              priority: 0,
            });
            close();
          }}
        >
          <ListTodo size={13} /> New task
        </button>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            setTeamProject(project.id);
            close();
          }}
        >
          <Users size={13} /> Team and delegation…
        </button>

        {roster.length > 0 && (
          <div className="ctx-roster">
            {roster.slice(0, 5).map((member) => (
              <span className="member-avatar" key={member.id} style={{ background: member.color }} title={member.name}>
                {member.name.charAt(0).toUpperCase()}
              </span>
            ))}
            <span className="faint">{roster.length} on the team</span>
          </div>
        )}

        {mobile && (
          <button className="ctx-item ctx-more" onClick={() => setPage("more")}>
            <Settings2 size={13} /> More actions
            <ChevronRight size={13} className="ctx-chevron" />
          </button>
        )}
          </>
        )}

        {(!mobile || page === "more") && (
          <>
        <div className="ctx-sep" />
        <div className="ctx-label">Color</div>
        <div className="ctx-swatches">
          {PALETTE.map((color) => (
            <button
              key={color}
              className="ctx-swatch"
              style={{ background: color }}
              data-active={project.color === color}
              title={color}
              aria-label={`Use ${color}`}
              onClick={() => {
                void updateWorkProject(project.id, { color });
                close();
              }}
            />
          ))}
        </div>

        <div className="ctx-sep" />
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            if (project.archivedAt) {
              void updateWorkProject(project.id, { archivedAt: null });
              toast(`Restored “${project.name}”`, {
                actionLabel: "Undo",
                action: () => void updateWorkProject(project.id, { archivedAt: project.archivedAt ?? null }),
              });
              close();
              return;
            }
            close();
            useUI.getState().askConfirm({
              title: `Archive “${project.name}”?`,
              body: "Its tasks stay where they are. You can restore it from the archived list at any time.",
              confirmLabel: "Archive project",
              danger: true,
              onConfirm: () => {
                void updateWorkProject(project.id, { archivedAt: Date.now() });
                useUI.getState().setSelectedWorkProject(null);
                toast(`Archived “${project.name}”`, {
                  actionLabel: "Undo",
                  action: () => void updateWorkProject(project.id, { archivedAt: null }),
                });
              },
            });
          }}
        >
          {project.archivedAt ? <RotateCcw size={13} /> : <Archive size={13} />}
          {project.archivedAt ? "Restore project" : "Archive project"}
        </button>
          </>
        )}
      </div>
    );
  }

  if (menu.kind === "scheduleOccurrence") {
    const schedule = schedules.find((candidate) => candidate.id === menu.scheduleId);
    const session = scheduleItems.find((candidate) => candidate.id === menu.scheduleItemId);
    if (!schedule || !session || menu.scheduleDay == null) return null;
    const day = sod(menu.scheduleDay);
    const previous = scheduleExceptions.find(
      (row) => row.sessionId === session.id && row.day === day,
    );
    const dayLabel = format(day, "EEEE, MMM d");
    const displayTitle =
      previous?.kind === "edit" ? (previous.title || session.name) : session.name;
    const timeLabel =
      menu.start != null && menu.end != null
        ? `${clockTime(menu.start, timeFormat)} – ${clockTime(menu.end, timeFormat)}`
        : null;

    const remove = () => {
      close();
      askConfirm({
        title: "Delete this occurrence?",
        body: `Only the ${dayLabel} occurrence will be removed. “${schedule.name}” and every other week stay unchanged.`,
        confirmLabel: "Delete occurrence",
        danger: true,
        onConfirm: () => {
          void (async () => {
            await deleteScheduleOccurrence(schedule.id, session.id, day);
            toast(`Deleted only ${format(day, "MMM d")}`, {
              actionLabel: "Undo",
              action: () => {
                if (previous?.kind === "edit") {
                  void saveScheduleException({
                    scheduleId: previous.scheduleId,
                    sessionId: previous.sessionId,
                    day: previous.day,
                    kind: "edit",
                    title: previous.title,
                    location: previous.location,
                    startMin: previous.startMin,
                    endMin: previous.endMin,
                  });
                } else {
                  void removeScheduleException(session.id, day);
                }
              },
            });
          })();
        },
      });
    };

    return (
      <div
        ref={ref}
        className="ctx ctx-calendar"
        role="menu"
        aria-label={`${displayTitle} occurrence actions`}
        style={{
          left: pos?.left ?? menu.x,
          top: pos?.top ?? menu.y,
          visibility: pos ? "visible" : "hidden",
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {sheetHandle}
        <div className="ctx-head">
          <span className="ctx-dot" style={{ background: schedule.color }} />
          <span className="ctx-name">{displayTitle}</span>
          <span className="ctx-count">{format(day, "MMM d")}</span>
        </div>
        <div className="ctx-label">
          One occurrence{timeLabel ? ` · ${timeLabel}` : ""}
        </div>

        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            setScheduleOccurrence({ scheduleId: schedule.id, sessionId: session.id, day });
            close();
          }}
        >
          <Pencil size={13} /> Edit this occurrence…
        </button>
        <button className="ctx-item danger" role="menuitem" onClick={remove}>
          <Trash2 size={13} /> Delete this occurrence…
        </button>
      </div>
    );
  }

  if (menu.kind === "schedule") {
    const schedule = schedules.find((candidate) => candidate.id === menu.scheduleId);
    if (!schedule) return null;
    const sessions = sessionsOf(scheduleItems, schedule.id);
    return (
      <div
        ref={ref}
        className="ctx ctx-calendar"
        role="menu"
        aria-label={`${schedule.name} actions`}
        style={{
          left: pos?.left ?? menu.x,
          top: pos?.top ?? menu.y,
          visibility: pos ? "visible" : "hidden",
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {sheetHandle}
        <div className="ctx-head">
          <span className="ctx-dot" style={{ background: schedule.color }} />
          <span className="ctx-name">{schedule.name}</span>
          <span className="ctx-count">{sessions.length}/wk</span>
        </div>

        {mobile && page === "more" && (
          <button className="ctx-item ctx-back" onClick={() => setPage("main")}>
            <ChevronLeft size={13} /> Back
          </button>
        )}

        {(!mobile || page === "main") && (
          <>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            setScheduleEditor(schedule.id);
            close();
          }}
        >
          <CalendarClock size={13} /> Open timetable
        </button>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            revealSchedule(schedule.id);
            close();
          }}
        >
          <CalendarDays size={13} /> Show on calendar
        </button>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            const hidden = !schedule.hidden;
            void updateSchedule(schedule.id, { hidden });
            toast(hidden ? `Hidden “${schedule.name}”` : `Showing “${schedule.name}”`, {
              actionLabel: "Undo",
              action: () => void updateSchedule(schedule.id, { hidden: !hidden }),
            });
            close();
          }}
        >
          {schedule.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
          {schedule.hidden ? "Show schedule" : "Hide schedule"}
        </button>
        <button
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            setBreaksOverview(schedule.id);
            close();
          }}
        >
          <CalendarOff size={13} /> Breaks…
        </button>

        {mobile && (
          <button className="ctx-item ctx-more" onClick={() => setPage("more")}>
            <Settings2 size={13} /> More actions
            <ChevronRight size={13} className="ctx-chevron" />
          </button>
        )}
          </>
        )}

        {(!mobile || page === "more") && (
          <>
        <div className="ctx-sep" />
        <div className="ctx-label">Color</div>
        <div className="ctx-swatches">
          {PALETTE.map((color) => (
            <button
              key={color}
              className="ctx-swatch"
              style={{ background: color }}
              data-active={schedule.color === color}
              title={color}
              aria-label={`Use ${color}`}
              onClick={() => {
                void updateSchedule(schedule.id, { color });
                close();
              }}
            />
          ))}
        </div>

        <div className="ctx-sep" />
        <button
          className="ctx-item danger"
          role="menuitem"
          onClick={() => {
            setScheduleDelete(schedule.id);
            close();
          }}
        >
          <Trash2 size={13} /> Delete schedule…
        </button>
          </>
        )}
      </div>
    );
  }

  const item = items.find((i) => i.id === menu.itemId && !i.deletedAt);
  if (!item) return null;
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;
  const project = projects.find((p) => p.id === item.projectId);
  const itemTags = (item.tagIds ?? [])
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .slice(0, 4);
  // A task row has no occurrence context, but may still own a time block.
  const displayStart = menu.start ?? item.start ?? undefined;
  const displayEnd = menu.start != null ? (menu.end ?? menu.start) : (item.end ?? displayStart);
  const when = whenLabel(item, { start: displayStart, end: displayEnd }, timeFormat);
  const done = isDone(item);

  const occ: Occurrence | undefined =
    menu.start == null
      ? undefined
      : {
          key: `${item.id}@${menu.originalStart ?? menu.start}`,
          item,
          start: menu.start,
          end: menu.end ?? menu.start,
          originalStart: menu.originalStart,
          isRecurring: menu.originalStart != null,
          isDue: menu.isDue,
        };

  const open = () => {
    openEdit(item.id, draftFromItem(item, occ), menu.originalStart);
    close();
  };

  const duplicate = async () => {
    await duplicateItem(item.id);
    toast(`Duplicated “${item.title || "Untitled"}”`);
    close();
  };

  const postpone = () => {
    openPostpone(item.id, menu.x, menu.y);
    close();
  };

  const toggleDone = async () => {
    const result = await toggleTaskComplete(item);
    if (result.nextDue) {
      toast(
        `Next: ${new Date(result.nextDue).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}`,
      );
    }
    close();
  };

  const remove = async () => {
    const master = masterOf(item, items);
    if (menu.originalStart != null) {
      const exceptionId = await cancelOccurrence(master, menu.originalStart);
      toast("Removed this occurrence", {
        actionLabel: "Undo",
        action: () => void purgeItem(exceptionId),
      });
    } else {
      // "Delete" on an instance takes the series, matching the editor.
      const targetId = item.recurrenceParentId ? master.id : item.id;
      await softDeleteItem(targetId);
      toast(`Deleted “${item.title || "Untitled"}”`, {
        actionLabel: "Undo",
        action: () => void restoreSubtree(targetId),
      });
    }
    close();
  };

  return (
    <div
      ref={ref}
      className="ctx ctx-quick"
      role="dialog"
      aria-label="Quick look"
      style={{
        left: pos?.left ?? menu.x,
        top: pos?.top ?? menu.y,
        visibility: pos ? "visible" : "hidden",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {sheetHandle}
      <div className="ql-head">
        <span className="ql-type">
          <Icon size={12} /> {meta.label}
        </span>
        {(item.recurrence || repeatsBlocks(item)) && (
          <span className="ql-badge">
            <Repeat size={9} /> repeats
          </span>
        )}
        <span className="spacer" />
        <button className="icon-btn" title="Close" onClick={close}>
          <X size={12} />
        </button>
      </div>

      <div className="ql-title">{item.title || "Untitled"}</div>

      <div className="ql-meta">
        {when && (
          <div className="ql-row">
            <Clock size={11} /> {when}
          </div>
        )}
        {project ? (
          <div className="ql-row">
            <span className="ctx-dot" style={{ background: project.color }} /> {project.name}
          </div>
        ) : (
          <div className="ql-row faint">No calendar</div>
        )}
        {item.location && (
          <div className="ql-row">
            <MapPin size={11} /> {item.location}
          </div>
        )}
        {(itemTags.length > 0 || item.priority || item.estimateMin || item.status) && (
          <div className="ql-row ql-chips">
            {item.type === "task" && item.status && item.status !== "todo" && (
              <span className="chip">{item.status === "doing" ? "In progress" : "Done"}</span>
            )}
            {item.priority ? <span className="chip">P{item.priority} {PRIORITY_LABEL[item.priority]}</span> : null}
            {item.estimateMin ? <span className="chip">{item.estimateMin}m</span> : null}
            {itemTags.map((tag) => (
              <span className="tag" key={tag.id}>
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {item.body && <div className="ql-body">{item.body}</div>}

      <div className="ql-actions">
        <button className="btn sm primary" onClick={open}>
          Open
        </button>
        {item.type === "task" && (
          <button className="btn sm" onClick={() => void toggleDone()}>
            {done ? "Reopen" : "Mark done"}
          </button>
        )}
        {item.type === "task" && (
          <button className="btn sm" onClick={() => void duplicate()}>
            <Copy size={11} /> Duplicate
          </button>
        )}
        {item.type === "task" && !done && isOverdue(item) && (
          <button className="btn sm" onClick={postpone}>
            <CalendarClock size={11} /> Postpone
          </button>
        )}
        {item.workProjectId && (
          <button
            className="btn sm"
            onClick={() => {
              setDelegationTask(item.id);
              close();
            }}
          >
            <Users size={11} /> Delegate
          </button>
        )}
        <span className="spacer" />
        <button className="btn sm danger" onClick={() => void remove()}>
          <Trash2 size={11} /> Delete
        </button>
      </div>
    </div>
  );
}
