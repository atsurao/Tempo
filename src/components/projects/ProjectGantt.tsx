import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GripVertical,
  MoveHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type { Item, TaskDependency, WorkProject } from "../../types";
import {
  computeProjectSchedule,
  moveTaskDates,
  resizeTaskDates,
  type ProjectSchedule,
  type ResizeEdge,
  type ScheduledDates,
} from "../../lib/projectSchedule";
import {
  GANTT_ROW_HEIGHT,
  GANTT_SCALE_DEFAULT,
  buildGanttRows,
  dayWidthForScale,
  ganttRange,
  type GanttRow,
} from "../../lib/gantt";
import { sod } from "../../lib/date";
import { openItemMenu } from "../../store/contextMenu";
import { useIsMobile } from "../../hooks/useIsMobile";

const TABLE_W = 390;
const HEADER_H = 38;
const ROW_H = GANTT_ROW_HEIGHT;

interface HeaderBlock {
  left: number;
  width: number;
  label: string;
}

interface DragState {
  id: string;
  kind: "move" | ResizeEdge;
  pointerId: number;
  originX: number;
  originStart: number;
  originEnd: number;
  deltaDays: number;
}

interface PreviewDates extends ScheduledDates {
  durationDays?: number;
}

interface LinkView {
  dependency: TaskDependency;
  d: string;
  hitD: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

type LinkDragMode = "new" | "retarget-start" | "retarget-end";

interface LinkDragState {
  mode: LinkDragMode;
  pointerId: number;
  sourceId?: string;
  dependencyId?: string;
  fixedX: number;
  fixedY: number;
  x: number;
  y: number;
}

function dayIndex(ts: number, from: number): number {
  return differenceInCalendarDays(sod(ts), from);
}

function datesForDrag(
  task: Item,
  current: ScheduledDates,
  kind: "move" | ResizeEdge,
  deltaDays: number,
  workingDays: number[],
): PreviewDates {
  if (kind === "move") {
    return { ...moveTaskDates(task, current, deltaDays, workingDays), durationDays: undefined };
  }
  return resizeTaskDates(task, current, kind, deltaDays, workingDays);
}

function headerBlocks(from: number, days: number, dayWidth: number): HeaderBlock[] {
  const blocks: HeaderBlock[] = [];

  if (dayWidth >= 30) {
    for (let i = 0; i < days; i++) {
      const date = addDays(from, i);
      blocks.push({
        left: i * dayWidth,
        width: dayWidth,
        // Name the month on its first day so two "S 1" cells cannot be confused.
        label:
          date.getDate() === 1
            ? format(date, "MMM d")
            : `${format(date, "EEEEE")} ${format(date, "d")}`,
      });
    }
    return blocks;
  }

  if (dayWidth >= 7) {
    for (let i = 0; i < days; i += 7) {
      blocks.push({
        left: i * dayWidth,
        width: Math.min(7, days - i) * dayWidth,
        label: format(addDays(from, i), "MMM d"),
      });
    }
    return blocks;
  }

  let cursor = new Date(from);
  cursor.setDate(1);
  for (let guard = 0; guard < 240; guard++) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    const left = Math.max(0, differenceInCalendarDays(cursor, from) * dayWidth);
    const right = Math.min(days * dayWidth, differenceInCalendarDays(next, from) * dayWidth);
    if (right > left) {
      blocks.push({
        left,
        width: right - left,
        // A clipped final month has no room for its label; leave it blank
        // rather than showing a truncated year.
        label: right - left >= 52 ? format(cursor, "MMM yyyy") : "",
      });
    }
    if (right >= days * dayWidth) break;
    cursor = next;
  }
  return blocks;
}

interface Props {
  project: WorkProject;
  tasks: Item[];
  dependencies: TaskDependency[];
  plan: ProjectSchedule;
  onOpen: (item: Item) => void;
  onReschedule: (
    task: Item,
    dates: ScheduledDates,
    durationDays?: number,
  ) => void | Promise<void>;
  onCreateDependency: (
    predecessorId: string,
    successorId: string,
  ) => Promise<TaskDependency | null>;
  onUpdateDependency: (
    id: string,
    patch: { predecessorId?: string; successorId?: string; lagDays?: number },
  ) => Promise<boolean>;
  onDeleteDependency: (dependency: TaskDependency) => Promise<void>;
  /** Move a task next to a sibling; parents stay put, children stay nested. */
  onReorder: (taskId: string, targetId: string, position: "before" | "after") => void;
}

/**
 * A project plan: the outline and the timeline share one scroll container, so
 * the task names stay pinned while the dates move. Leaf bars and milestones
 * can be dragged sideways; dropping one pins its new dates and the scheduler
 * recalculates every dependent task. Link dots draw finish-to-start links,
 * selected links expose endpoint handles for retargeting, and the small
 * popover edits lag or deletes the link. Summary bars only report children.
 */
export function ProjectGantt({
  project,
  tasks,
  dependencies,
  plan,
  onOpen,
  onReschedule,
  onCreateDependency,
  onUpdateDependency,
  onDeleteDependency,
  onReorder,
}: Props) {
  const mobile = useIsMobile();
  const [scale, setScale] = useState(GANTT_SCALE_DEFAULT);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [linkDrag, setLinkDrag] = useState<LinkDragState | null>(null);
  const linkDragRef = useRef<LinkDragState | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [orderDragId, setOrderDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const [lagDraft, setLagDraft] = useState("0");
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastDragAt = useRef(0);
  const lastLinkDragAt = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousDayWidth = useRef<number | null>(null);
  const initialisedProject = useRef<string | null>(null);
  const rescheduleRef = useRef(onReschedule);
  const linkActions = useRef({ onCreateDependency, onUpdateDependency, onDeleteDependency });

  useEffect(() => {
    linkActions.current = { onCreateDependency, onUpdateDependency, onDeleteDependency };
  }, [onCreateDependency, onUpdateDependency, onDeleteDependency]);

  const dayWidth = dayWidthForScale(scale);

  useEffect(() => {
    rescheduleRef.current = onReschedule;
  }, [onReschedule]);

  const dragTask = drag ? tasks.find((task) => task.id === drag.id) : undefined;
  const preview = useMemo(() => {
    if (!drag || !dragTask || drag.deltaDays === 0) return null;
    return datesForDrag(
      dragTask,
      { start: drag.originStart, end: drag.originEnd },
      drag.kind,
      drag.deltaDays,
      project.workingDays,
    );
  }, [drag, dragTask, project.workingDays]);

  // Recompute the whole plan while dragging so dependent bars and the links
  // between them follow the pointer, not just the bar under it.
  const activeTasks = useMemo(() => {
    if (!preview || !drag) return tasks;
    return tasks.map((task) =>
      task.id === drag.id
        ? {
            ...task,
            scheduleMode: "manual" as const,
            plannedStart: preview.start,
            plannedEnd: preview.end,
            ...(preview.durationDays != null
              ? { durationDays: preview.durationDays }
              : {}),
          }
        : task,
    );
  }, [tasks, drag, preview]);

  const activePlan = useMemo(() => {
    if (!preview) return plan;
    return computeProjectSchedule({ project, tasks: activeTasks, dependencies });
  }, [preview, project, activeTasks, dependencies, plan]);

  const rows = useMemo(() => {
    const conflicted = new Set(
      activePlan.conflicts.map((conflict) => conflict.taskId).filter(Boolean) as string[],
    );
    return buildGanttRows(activeTasks, activePlan.dates, project.workingDays, conflicted);
  }, [activeTasks, activePlan, project.workingDays]);

  const range = useMemo(() => ganttRange(project, rows), [project, rows]);
  const fitDays =
    viewportWidth > TABLE_W ? Math.floor((viewportWidth - TABLE_W) / dayWidth) : 0;
  const shownDays = Math.max(range.days, fitDays);
  const trackWidth = shownDays * dayWidth;
  const headers = useMemo(
    () => headerBlocks(range.from, shownDays, dayWidth),
    [range.from, shownDays, dayWidth],
  );
  const rowIndex = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows]);
  const today = sod(Date.now());
  const todayX =
    today >= range.from && today < range.to
      ? differenceInCalendarDays(today, range.from) * dayWidth + dayWidth / 2
      : null;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || initialisedProject.current === project.id) return;
    const offset = differenceInCalendarDays(sod(project.start), range.from) * dayWidth;
    element.scrollLeft = Math.max(0, offset - Math.min(dayWidth * 7, 140));
    element.scrollTop = 0;
    initialisedProject.current = project.id;
  }, [project.id, project.start, range.from, dayWidth, rows.length]);

  // A continuous scale should keep the date under the middle of the viewport
  // put, rather than jumping back to the project start on every slider tick.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const previous = previousDayWidth.current;
    previousDayWidth.current = dayWidth;
    if (!element || previous == null || previous === dayWidth) return;
    const center = element.scrollLeft + element.clientWidth / 2 - TABLE_W;
    element.scrollLeft = Math.max(
      0,
      TABLE_W + (center / previous) * dayWidth - element.clientWidth / 2,
    );
  }, [dayWidth]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setViewportWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [rows.length]);

  useEffect(() => {
    if (!drag) return;

    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const minDelta =
        current.kind === "end"
          ? Number.NEGATIVE_INFINITY
          : Math.min(
              0,
              differenceInCalendarDays(sod(project.start), current.originStart),
            );
      const next = Math.max(
        minDelta,
        Math.round((event.clientX - current.originX) / dayWidth),
      );
      if (next === current.deltaDays) return;
      const updated = { ...current, deltaDays: next };
      dragRef.current = updated;
      setDrag(updated);
    };

    const onUp = async (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      dragRef.current = null;
      if (current.deltaDays === 0) {
        setDrag(null);
        return;
      }
      lastDragAt.current = Date.now();
      const task = tasks.find((candidate) => candidate.id === current.id);
      if (!task) {
        setDrag(null);
        return;
      }
      const moved = datesForDrag(
        task,
        { start: current.originStart, end: current.originEnd },
        current.kind,
        current.deltaDays,
        project.workingDays,
      );
      // Snapping can land back on the original days after a small drag; do not
      // silently switch the task to manual when nothing actually moved.
      if (moved.start === current.originStart && moved.end === current.originEnd) {
        setDrag(null);
        return;
      }
      try {
        await rescheduleRef.current(task, moved, moved.durationDays);
      } finally {
        setDrag(null);
      }
    };

    const onCancel = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      dragRef.current = null;
      setDrag(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [drag?.id, dayWidth, project.start, project.workingDays, tasks]);

  const beginDrag = (
    event: React.PointerEvent<HTMLElement>,
    row: GanttRow,
    kind: "move" | ResizeEdge = "move",
  ) => {
    // Dragging a bar would fight the scroll gesture underneath it on a phone.
    // The task editor still owns every date change there.
    if (mobile) return;
    if (row.summary || row.start == null || row.end == null || event.button !== 0) return;
    if (kind !== "move" && row.milestone) return;
    event.preventDefault();
    const next: DragState = {
      id: row.id,
      kind,
      pointerId: event.pointerId,
      originX: event.clientX,
      originStart: row.start,
      originEnd: row.end,
      deltaDays: 0,
    };
    dragRef.current = next;
    setDrag(next);
  };

  const gridDays = useMemo(
    () =>
      Array.from({ length: shownDays }, (_, index) => {
        const date = addDays(range.from, index);
        return (
          <span
            key={index}
            className="gantt-day-cell"
            data-weekend={[0, 6].includes(date.getDay())}
            data-today={sod(date.getTime()) === today}
            style={{ left: index * dayWidth, width: dayWidth }}
          />
        );
      }),
    [shownDays, range.from, dayWidth, today],
  );

  const geometry = (row: GanttRow): { left: number; width: number } | null => {
    if (row.start == null || row.end == null) return null;
    const first = dayIndex(row.start, range.from);
    const last = dayIndex(row.end, range.from);
    return {
      left: first * dayWidth + 1,
      width: Math.max(dayWidth - 2, (last - first + 1) * dayWidth - 2),
    };
  };

  const linkViews = useMemo<LinkView[]>(() => {
    return dependencies.flatMap((dependency) => {
      if (dependency.workProjectId !== project.id || dependency.type !== "FS") return [];
      const from = rows[rowIndex.get(dependency.predecessorId) ?? -1];
      const to = rows[rowIndex.get(dependency.successorId) ?? -1];
      if (!from || !to || from.start == null || from.end == null || to.start == null) return [];
      const fromGeometry = geometry(from);
      const toGeometry = geometry(to);
      if (!fromGeometry || !toGeometry) return [];

      const sx =
        fromGeometry.left +
        (from.milestone ? fromGeometry.width / 2 : fromGeometry.width);
      const tx =
        toGeometry.left + (to.milestone ? toGeometry.width / 2 : 0);
      const sy = (rowIndex.get(from.id) ?? 0) * ROW_H + ROW_H / 2;
      const ty = (rowIndex.get(to.id) ?? 0) * ROW_H + ROW_H / 2;
      const lead = 10;
      // Keep the wide click target off the bars and resize edges it connects.
      const hitStart = sx + (from.milestone ? 10 : 8);
      const hitEnd = tx - (to.milestone ? 10 : 8);
      return [
        {
          dependency,
          d: `M ${sx} ${sy} H ${sx + lead} V ${ty} H ${tx}`,
          hitD: `M ${hitStart} ${sy} H ${sx + lead} V ${ty} H ${hitEnd}`,
          sx,
          sy,
          tx,
          ty,
        },
      ];
    });
  }, [dependencies, project.id, rows, rowIndex, range.from, dayWidth]);

  const selectedView =
    linkViews.find((view) => view.dependency.id === selectedLinkId) ?? null;
  const selectedDependency = selectedView?.dependency ?? null;

  useEffect(() => {
    if (selectedLinkId && !selectedView) setSelectedLinkId(null);
  }, [selectedLinkId, selectedView]);

  useEffect(() => {
    if (selectedDependency) setLagDraft(String(selectedDependency.lagDays));
  }, [selectedDependency?.id, selectedDependency?.lagDays]);

  const editorPosition = selectedView
    ? (() => {
        const width = 232;
        const gap = 14;
        const leftEdge = Math.min(selectedView.sx, selectedView.tx);
        const rightEdge = Math.max(selectedView.sx, selectedView.tx);
        const preferred =
          trackWidth - rightEdge - gap >= width
            ? rightEdge + gap
            : leftEdge - gap - width >= 0
              ? leftEdge - gap - width
              : (selectedView.sx + selectedView.tx) / 2 - width / 2;
        return {
          left: TABLE_W + Math.max(8, Math.min(trackWidth - width - 8, preferred)),
          top:
            HEADER_H +
            Math.max(
              8,
              Math.min(
                Math.max(8, rows.length * ROW_H - 160),
                Math.min(selectedView.sy, selectedView.ty) - 12,
              ),
            ),
        };
      })()
    : null;

  useEffect(() => {
    if (!linkDrag) return;

    const point = (clientX: number, clientY: number) => {
      const body = bodyRef.current;
      if (!body) return null;
      const rect = body.getBoundingClientRect();
      return {
        x: Math.min(Math.max(0, clientX - rect.left - TABLE_W), trackWidth),
        y: Math.min(Math.max(0, clientY - rect.top), rows.length * ROW_H),
      };
    };

    const onMove = (event: PointerEvent) => {
      const current = linkDragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const next = point(event.clientX, event.clientY);
      if (!next) return;
      const updated = { ...current, x: next.x, y: next.y };
      linkDragRef.current = updated;
      setLinkDrag(updated);
    };

    const onUp = async (event: PointerEvent) => {
      const current = linkDragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      linkDragRef.current = null;
      lastLinkDragAt.current = Date.now();
      setLinkDrag(null);

      // Links and the editor sit above rows, so resolve the drop row from the
      // body geometry rather than trusting elementFromPoint.
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (element?.closest(".gantt-link-editor")) return;
      const body = bodyRef.current;
      const viewport = scrollRef.current;
      if (!body || !viewport) return;
      const bodyRect = body.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (
        event.clientX < viewportRect.left ||
        event.clientX > viewportRect.right ||
        event.clientY < viewportRect.top + HEADER_H ||
        event.clientY > viewportRect.bottom
      ) {
        return;
      }
      const index = Math.floor((event.clientY - bodyRect.top) / ROW_H);
      const target = rows[index];
      if (!target || target.summary) return;
      const targetId = target.id;

      if (current.mode === "new") {
        if (!current.sourceId || current.sourceId === targetId) return;
        const created = await linkActions.current.onCreateDependency(
          current.sourceId,
          targetId,
        );
        if (created) setSelectedLinkId(created.id);
        return;
      }

      const dependency = dependencies.find((item) => item.id === current.dependencyId);
      if (!dependency) return;
      if (current.mode === "retarget-start") {
        if (targetId === dependency.predecessorId || targetId === dependency.successorId) return;
        const changed = await linkActions.current.onUpdateDependency(dependency.id, {
          predecessorId: targetId,
        });
        if (changed) setSelectedLinkId(dependency.id);
        return;
      }
      if (targetId === dependency.predecessorId || targetId === dependency.successorId) return;
      const changed = await linkActions.current.onUpdateDependency(dependency.id, {
        successorId: targetId,
      });
      if (changed) setSelectedLinkId(dependency.id);
    };

    const onCancel = (event: PointerEvent) => {
      const current = linkDragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      linkDragRef.current = null;
      setLinkDrag(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [linkDrag?.pointerId, trackWidth, rows, dependencies]);

  const startLinkDrag = (state: LinkDragState) => {
    linkDragRef.current = state;
    setLinkDrag(state);
  };

  const beginLinkDraw = (event: React.PointerEvent<HTMLElement>, row: GanttRow) => {
    if (mobile) return;
    if (row.summary || row.start == null || row.end == null || event.button !== 0) return;
    const bar = geometry(row);
    if (!bar) return;
    event.preventDefault();
    event.stopPropagation();
    void commitLag();
    setSelectedLinkId(null);
    setLagDraft("0");
    const sy = (rowIndex.get(row.id) ?? 0) * ROW_H + ROW_H / 2;
    const sx = bar.left + (row.milestone ? bar.width / 2 : bar.width);
    startLinkDrag({
      mode: "new",
      pointerId: event.pointerId,
      sourceId: row.id,
      fixedX: sx,
      fixedY: sy,
      x: sx,
      y: sy,
    });
  };

  const beginLinkRetarget = (
    event: React.PointerEvent<SVGCircleElement>,
    view: LinkView,
    side: "start" | "end",
  ) => {
    if (mobile || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedLinkId(view.dependency.id);
    startLinkDrag({
      mode: side === "start" ? "retarget-start" : "retarget-end",
      pointerId: event.pointerId,
      dependencyId: view.dependency.id,
      fixedX: side === "start" ? view.tx : view.sx,
      fixedY: side === "start" ? view.ty : view.sy,
      x: side === "start" ? view.sx : view.tx,
      y: side === "start" ? view.sy : view.ty,
    });
  };

  const commitLag = async () => {
    if (!selectedDependency) return;
    const lag = Math.max(0, Math.round(Number(lagDraft) || 0));
    setLagDraft(String(lag));
    if (lag !== selectedDependency.lagDays) {
      await onUpdateDependency(selectedDependency.id, { lagDays: lag });
    }
  };

  const removeSelectedDependency = () => {
    if (!selectedDependency) return;
    setSelectedLinkId(null);
    void onDeleteDependency(selectedDependency);
  };

  const titleOf = (id: string) =>
    tasks.find((task) => task.id === id)?.title || "Untitled";

  return (
    <div
      className="gantt"
      data-dragging={drag || linkDrag ? "true" : undefined}
      data-drag-kind={drag?.kind}
      data-linking={linkDrag ? "true" : undefined}
    >
      <div className="gantt-toolbar">
        <span className="gantt-sub">Bars move · edges resize · link dots connect</span>
        <span className="spacer" />
        <label className="gantt-scale">
          <span className="gantt-scale-icon" aria-hidden>
            <MoveHorizontal size={13} />
          </span>
          <span className="gantt-scale-tooltip" aria-hidden="true">
            Scale
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={scale}
            aria-label="Gantt timeline scale"
            aria-valuetext={`One day is ${dayWidth.toFixed(1)} pixels`}
            style={{ "--gantt-scale-fill": `${scale}%` } as CSSProperties}
            onChange={(event) => setScale(Number(event.target.value))}
          />
        </label>
      </div>

      {activePlan.conflicts.length > 0 && (
        <div className="gantt-conflict-note">
          <AlertTriangle size={11} />
          <span>{activePlan.conflicts[0].message}</span>
          {activePlan.conflicts.length > 1 && (
            <span className="faint">and {activePlan.conflicts.length - 1} more</span>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty">
          <strong>Nothing to plot yet</strong>
          Add tasks to this project and they appear here with their planned dates.
        </div>
      ) : (
        <>
          <div
            className="gantt-scroll"
            ref={scrollRef}
            onClick={(event) => {
              if (Date.now() - lastLinkDragAt.current < 400) return;
              const target = event.target as Element;
              if (
                target.closest(
                  ".gantt-link-hit, .gantt-link-handle, .gantt-link-editor, .gantt-link-dot",
                )
              ) {
                return;
              }
              setSelectedLinkId(null);
            }}
          >
            <div
              className="gantt-canvas"
              style={{ width: TABLE_W + trackWidth }}
            >
              <div className="gantt-head" style={{ height: HEADER_H }}>
                <div className="gantt-corner" style={{ width: TABLE_W }}>
                  <span className="gantt-col-task">Task</span>
                  <span>Start</span>
                  <span>Finish</span>
                  <span>Dur</span>
                  <span>%</span>
                </div>
                <div className="gantt-head-track" style={{ width: trackWidth }}>
                  {headers.map((header, index) => (
                    <div
                      key={index}
                      className="gantt-head-block"
                      style={{ left: header.left, width: header.width }}
                    >
                      {header.label}
                    </div>
                  ))}
                </div>
              </div>

              <div
                className="gantt-body"
                ref={bodyRef}
                style={{ height: rows.length * ROW_H }}
              >
                <div
                  className="gantt-grid"
                  style={{ left: TABLE_W, width: trackWidth }}
                >
                  {gridDays}
                </div>

                <svg
                  className="gantt-links"
                  width={trackWidth}
                  height={rows.length * ROW_H}
                  style={{ left: TABLE_W }}
                  aria-hidden
                >
                  <defs>
                    <marker
                      id={`gantt-arrow-${project.id}`}
                      markerWidth="7"
                      markerHeight="7"
                      refX="6"
                      refY="3.5"
                      orient="auto"
                    >
                      <path d="M 0 0 L 7 3.5 L 0 7 z" className="gantt-arrowhead" />
                    </marker>
                  </defs>
                  {linkViews.map((view) => (
                    <g key={view.dependency.id}>
                      <path
                        d={view.d}
                        className="gantt-link"
                        data-selected={
                          view.dependency.id === selectedLinkId || undefined
                        }
                        markerEnd={`url(#gantt-arrow-${project.id})`}
                      />
                      <path
                        d={view.hitD}
                        className="gantt-link-hit"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          void commitLag();
                          setSelectedLinkId(view.dependency.id);
                        }}
                      />
                      {view.dependency.id === selectedLinkId && (
                        <>
                          <circle
                            className="gantt-link-handle"
                            cx={view.sx}
                            cy={view.sy}
                            r={4.5}
                            onPointerDown={(event) =>
                              beginLinkRetarget(event, view, "start")
                            }
                          >
                            <title>Drag to change the predecessor</title>
                          </circle>
                          <circle
                            className="gantt-link-handle"
                            cx={view.tx}
                            cy={view.ty}
                            r={4.5}
                            onPointerDown={(event) =>
                              beginLinkRetarget(event, view, "end")
                            }
                          >
                            <title>Drag to change the successor</title>
                          </circle>
                        </>
                      )}
                    </g>
                  ))}
                  {linkDrag && (
                    <path
                      className="gantt-link-draft"
                      d={`M ${linkDrag.fixedX} ${linkDrag.fixedY} L ${linkDrag.x} ${linkDrag.y}`}
                    />
                  )}
                </svg>

                {todayX != null && (
                  <span
                    className="gantt-today"
                    style={{ left: TABLE_W + todayX }}
                    title="Today"
                  />
                )}

                {rows.map((row) => {
                  const bar = geometry(row);
                  const siblings = rows.filter(
                    (candidate) =>
                      (candidate.task.parentId ?? null) === (row.task.parentId ?? null),
                  );
                  const siblingIndex = siblings.findIndex(
                    (candidate) => candidate.id === row.id,
                  );
                  const previous = siblings[siblingIndex - 1];
                  const next = siblings[siblingIndex + 1];
                  const draggable = !row.summary;
                  const resizable = draggable && !row.milestone && bar != null && bar.width >= 18;
                  const dragHint = draggable
                    ? resizable
                      ? " · drag to move · drag an edge to resize"
                      : " · drag to move"
                    : "";
                  return (
                    <div
                      key={row.id}
                      className="gantt-row"
                      data-gantt-row-id={row.id}
                      data-summary={row.summary || undefined}
                      data-warning={row.warnings > 0 || undefined}
                      data-drag-source={orderDragId === row.id || undefined}
                      data-drop-before={
                        dropTarget?.id === row.id && dropTarget.position === "before"
                          ? "true"
                          : undefined
                      }
                      data-drop-after={
                        dropTarget?.id === row.id && dropTarget.position === "after"
                          ? "true"
                          : undefined
                      }
                      onDragOver={(event) => {
                        if (!orderDragId || orderDragId === row.id) return;
                        event.preventDefault();
                        const rect = event.currentTarget.getBoundingClientRect();
                        const position =
                          event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                        if (
                          dropTarget?.id !== row.id ||
                          dropTarget.position !== position
                        ) {
                          setDropTarget({ id: row.id, position });
                        }
                      }}
                      onDragLeave={() =>
                        setDropTarget((current) =>
                          current?.id === row.id ? null : current,
                        )
                      }
                      onDrop={(event) => {
                        event.preventDefault();
                        if (orderDragId && dropTarget) {
                          onReorder(orderDragId, dropTarget.id, dropTarget.position);
                        }
                        setOrderDragId(null);
                        setDropTarget(null);
                      }}
                      onDragEnd={() => {
                        setOrderDragId(null);
                        setDropTarget(null);
                      }}
                      style={{ height: ROW_H }}
                      onDoubleClick={() => {
                        if (Date.now() - lastDragAt.current < 400) return;
                        onOpen(row.task);
                      }}
                      onClick={() => {
                        if (!mobile) return;
                        if (Date.now() - lastDragAt.current < 400) return;
                        onOpen(row.task);
                      }}
                      onContextMenu={(event) => openItemMenu(event, row.task)}
                      title={
                        draggable
                          ? "Drag to reschedule · drag an edge to resize · double-click to open the task"
                          : "Double-click to open the task"
                      }
                    >
                      <div className="gantt-name" style={{ width: TABLE_W }}>
                        <span
                          className="gantt-col-task"
                          style={{ paddingLeft: 8 + row.depth * 14 }}
                        >
                          <span
                            className="gantt-grip"
                            draggable
                            title="Drag to reorder in the outline"
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", row.id);
                              setOrderDragId(row.id);
                            }}
                            onDragEnd={() => {
                              setOrderDragId(null);
                              setDropTarget(null);
                            }}
                          >
                            <GripVertical size={10} />
                          </span>
                          <span className="gantt-wbs">{row.wbs}</span>
                          <span className="gantt-task-title">
                            {row.task.title || "Untitled"}
                          </span>
                          {row.warnings > 0 && (
                            <span
                              className="gantt-row-warning"
                              title={`${row.warnings} scheduling ${
                                row.warnings === 1 ? "conflict" : "conflicts"
                              }`}
                            >
                              <AlertTriangle size={9} />
                            </span>
                          )}
                          <span className="gantt-move">
                            <button
                              type="button"
                              className="gantt-move-btn"
                              disabled={!previous}
                              title="Move up"
                              aria-label="Move up in the outline"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (previous) onReorder(row.id, previous.id, "before");
                              }}
                            >
                              <ChevronUp size={9} />
                            </button>
                            <button
                              type="button"
                              className="gantt-move-btn"
                              disabled={!next}
                              title="Move down"
                              aria-label="Move down in the outline"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (next) onReorder(row.id, next.id, "after");
                              }}
                            >
                              <ChevronDown size={9} />
                            </button>
                          </span>
                        </span>
                        <span className="gantt-cell">
                          {row.start != null ? format(row.start, "MMM d") : "—"}
                        </span>
                        <span className="gantt-cell">
                          {row.end != null ? format(row.end, "MMM d") : "—"}
                        </span>
                        <span className="gantt-cell">
                          {row.durationDays == null ? "—" : `${row.durationDays}d`}
                        </span>
                        <span className="gantt-cell">{row.progress}%</span>
                      </div>

                      <div className="gantt-track" style={{ width: trackWidth }}>
                        {bar && row.milestone && (
                          <span
                            className="gantt-milestone"
                            data-draggable="true"
                            data-dragged={drag?.id === row.id || undefined}
                            onPointerDown={(event) => beginDrag(event, row)}
                            style={{
                              left: bar.left + bar.width / 2 - 5,
                              background: project.color,
                            }}
                            title={`${row.task.title} · milestone · ${format(
                              row.start!,
                              "MMM d, yyyy",
                            )}${dragHint}`}
                          />
                        )}
                        {bar && !row.milestone && (
                          <span
                            className="gantt-bar"
                            data-summary={row.summary || undefined}
                            data-draggable={draggable || undefined}
                            data-dragged={drag?.id === row.id || undefined}
                            onPointerDown={
                              draggable ? (event) => beginDrag(event, row) : undefined
                            }
                            style={{
                              left: bar.left,
                              width: bar.width,
                              borderColor: project.color,
                              background: row.summary
                                ? project.color
                                : `color-mix(in srgb, ${project.color} 24%, var(--surface))`,
                            }}
                            title={`${row.task.title} · ${format(
                              row.start!,
                              "MMM d",
                            )} – ${format(row.end!, "MMM d")}${
                              row.warnings ? " · has a conflict" : ""
                            }${dragHint}`}
                          >
                            <span
                              className="gantt-bar-progress"
                              style={{
                                width: `${row.progress}%`,
                                background: project.color,
                              }}
                            />
                            {bar.width > 70 && !row.summary && (
                              <span className="gantt-bar-label">
                                {row.task.title || "Untitled"}
                              </span>
                            )}
                            {resizable && (
                              <>
                                <span
                                  className="gantt-resize gantt-resize-start"
                                  title="Resize start"
                                  onPointerDown={(event) => {
                                    event.stopPropagation();
                                    beginDrag(event, row, "start");
                                  }}
                                />
                                <span
                                  className="gantt-resize gantt-resize-end"
                                  title="Resize finish"
                                  onPointerDown={(event) => {
                                    event.stopPropagation();
                                    beginDrag(event, row, "end");
                                  }}
                                />
                              </>
                            )}
                          </span>
                        )}
                        {bar && !row.summary && (
                          <button
                            type="button"
                            className="gantt-link-dot"
                            style={{
                              left:
                                bar.left +
                                (row.milestone ? bar.width / 2 : bar.width) -
                                3,
                            }}
                            title={`Drag to link “${row.task.title || "Untitled"}” to a successor`}
                            aria-label={`Create a dependency from ${row.task.title || "untitled task"}`}
                            onPointerDown={(event) => beginLinkDraw(event, row)}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedView && selectedDependency && editorPosition && !linkDrag && (
                <div
                  className="gantt-link-editor"
                  style={editorPosition}
                  onPointerDown={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-label="Dependency link"
                >
                  <div className="gantt-link-editor-head">
                    <span>Finish to start</span>
                    <button
                      className="icon-btn"
                      title="Close"
                      aria-label="Close dependency editor"
                      onClick={() => setSelectedLinkId(null)}
                    >
                      <X size={10} />
                    </button>
                  </div>
                  <div className="gantt-link-editor-route">
                    <span title={titleOf(selectedDependency.predecessorId)}>
                      {titleOf(selectedDependency.predecessorId)}
                    </span>
                    <span className="gantt-link-editor-arrow">→</span>
                    <span title={titleOf(selectedDependency.successorId)}>
                      {titleOf(selectedDependency.successorId)}
                    </span>
                  </div>
                  <label className="gantt-link-lag">
                    <span>Lag</span>
                    <input
                      value={lagDraft}
                      inputMode="numeric"
                      aria-label="Lag in working days"
                      onChange={(event) =>
                        setLagDraft(
                          event.target.value.replace(/[^0-9]/g, "").slice(0, 4),
                        )
                      }
                      onBlur={() => void commitLag()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        } else if (event.key === "Escape") {
                          setLagDraft(String(selectedDependency.lagDays));
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <span>working days</span>
                  </label>
                  <p className="gantt-link-hint">Drag either endpoint to retarget.</p>
                  <button
                    className="btn sm subtle gantt-link-delete"
                    onClick={removeSelectedDependency}
                  >
                    <Trash2 size={10} /> Delete link
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="gantt-legend">
            <span>
              <i className="gantt-legend-bar" style={{ background: project.color }} />
              Task
            </span>
            <span>
              <i className="gantt-legend-summary" style={{ background: project.color }} />
              Summary
            </span>
            <span>
              <i className="gantt-legend-milestone" style={{ background: project.color }} />
              Milestone
            </span>
            <span>
              <i className="gantt-legend-link" />
              Dependency
            </span>
          </div>
        </>
      )}
    </div>
  );
}
