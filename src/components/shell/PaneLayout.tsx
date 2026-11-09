import { Fragment, useEffect, useState, type DragEvent } from "react";
import {
  CalendarDays,
  ChartGantt,
  Columns3,
  Flame,
  FolderKanban,
  LayoutDashboard,
  List,
  ListTodo,
  PartyPopper,
  Plus,
  StickyNote,
  Sun,
  Target,
  Timer,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useUI,
  type CalendarMode,
  type Column,
  type PaneDropSide,
  type PaneKind,
  type PaneRef,
} from "../../store/ui";
import { useViewDrag } from "../../store/viewDrag";
import { createItem } from "../../db/db";
import { useWorkProjects } from "../../db/hooks";
import { sod } from "../../lib/date";
import { PaneFrame } from "./PaneFrame";
import { Select } from "../ui/Select";
import { useIsMobile } from "../../hooks/useIsMobile";
import { CalendarView } from "../calendar/CalendarView";
import { TaskPane } from "../tasks/TaskPane";
import { HabitsPane } from "../habits/HabitsPane";
import { ProjectsPane } from "../projects/ProjectsPane";
import { GoalsPane } from "../goals/GoalsPane";
import { TodayPane } from "../today/TodayPane";
import { NotesPane } from "../notes/NotesPane";
import { FocusPane } from "../focus/FocusPane";
import { WidgetsPane } from "../widgets/WidgetsPane";

/** Grid views first, then the list-style agenda, kept apart by a hairline. */
const CALENDAR_MODES: { id: CalendarMode; label: string; separated?: boolean }[] = [
  { id: "year", label: "Year" },
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
  { id: "agenda", label: "Agenda", separated: true },
];

const PANE_META: Record<PaneKind, { label: string; icon: typeof Sun }> = {
  today: { label: "Today", icon: Sun },
  widgets: { label: "Widgets", icon: LayoutDashboard },
  calendar: { label: "Calendar", icon: CalendarDays },
  tasks: { label: "Tasks", icon: ListTodo },
  habits: { label: "Habits", icon: Flame },
  projects: { label: "Projects", icon: FolderKanban },
  goals: { label: "Goals", icon: Target },
  notes: { label: "Notes", icon: StickyNote },
  focus: { label: "Focus", icon: Timer },
};

type ViewDropSide = PaneDropSide | "center";

export function PaneLayout() {
  const layout = useUI((s) => s.layout);
  const activeView = useUI((s) => s.activeView);
  const mobile = useIsMobile();
  const setColumnSize = useUI((s) => s.setColumnSize);
  const setPaneSize = useUI((s) => s.setPaneSize);
  const addPane = useUI((s) => s.addPane);
  const addPaneAt = useUI((s) => s.addPaneAt);
  const setActiveView = useUI((s) => s.setActiveView);
  const draggedView = useViewDrag((s) => s.kind);
  const endViewDrag = useViewDrag((s) => s.end);
  const [dropSide, setDropSide] = useState<ViewDropSide | null>(null);

  type Drag =
    | {
        kind: "h";
        ids: [string, string];
        total: number;
        pair: number;
        startPosition: number;
        startSize: number;
        rect: DOMRect;
      }
    | {
        kind: "v";
        columnId: string;
        ids: [string, string];
        total: number;
        pair: number;
        startPosition: number;
        startSize: number;
        rect: DOMRect;
      };

  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (drag.kind === "h") {
        const delta = ((e.clientX - drag.startPosition) / drag.rect.width) * drag.total;
        const left = Math.min(
          Math.max(drag.startSize + delta, drag.total * 0.15),
          drag.pair - drag.total * 0.15,
        );
        setColumnSize(drag.ids[0], left);
        setColumnSize(drag.ids[1], drag.pair - left);
      } else {
        const delta = ((e.clientY - drag.startPosition) / drag.rect.height) * drag.total;
        const top = Math.min(
          Math.max(drag.startSize + delta, drag.total * 0.15),
          drag.pair - drag.total * 0.15,
        );
        setPaneSize(drag.columnId, drag.ids[0], top);
        setPaneSize(drag.columnId, drag.ids[1], drag.pair - top);
      }
    };
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    document.body.style.cursor = drag.kind === "h" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [drag, setColumnSize, setPaneSize]);

  const startColumnSplit = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    const workspace = event.currentTarget.closest(".workspace");
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    const total = layout.columns.reduce((s, c) => s + c.size, 0);
    const pair = layout.columns[index - 1].size + layout.columns[index].size;
    setDrag({
      kind: "h",
      ids: [layout.columns[index - 1].id, layout.columns[index].id],
      total,
      pair,
      startPosition: event.clientX,
      startSize: layout.columns[index - 1].size,
      rect,
    });
  };

  const startPaneSplit = (
    column: Column,
    index: number,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const parent = event.currentTarget.closest(".pane-col");
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const total = column.panes.reduce((s, p) => s + p.size, 0);
    const pair = column.panes[index - 1].size + column.panes[index].size;
    setDrag({
      kind: "v",
      columnId: column.id,
      ids: [column.panes[index - 1].id, column.panes[index].id],
      total,
      pair,
      startPosition: event.clientY,
      startSize: column.panes[index - 1].size,
      rect,
    });
  };

  useEffect(() => {
    if (!draggedView) setDropSide(null);
  }, [draggedView]);

  const dropSideAt = (event: DragEvent<HTMLDivElement>): ViewDropSide => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - bounds.left) / bounds.width;
    if (fraction < 0.33) return "left";
    if (fraction > 0.67) return "right";
    return "center";
  };

  const onViewDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggedView) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const next = dropSideAt(event);
    setDropSide((current) => (current === next ? current : next));
  };

  const onViewDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropSide(null);
  };

  const onViewDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!draggedView) return;
    event.preventDefault();
    event.stopPropagation();
    const side = dropSideAt(event);
    setActiveView(draggedView);
    if (side === "center") addPane(draggedView);
    else addPaneAt(draggedView, side);
    setDropSide(null);
    endViewDrag();
  };

  if (mobile) {
    // A phone shows one view at a time. The active bottom tab picks the pane;
    // if a desktop layout was restored, its matching pane is reused rather
    // than forcing every column onto a 390px screen.
    const panes = layout.columns.flatMap((column) =>
      column.panes.map((pane) => ({ pane, column })),
    );
    const chosen = panes.find((entry) => entry.pane.kind === activeView) ?? panes[0];
    if (!chosen) return <div className="workspace" data-mobile="true" />;
    return (
      <div className="workspace" data-mobile="true">
        <PaneView pane={chosen.pane} column={chosen.column} />
      </div>
    );
  }

  return (
    <div
      className="workspace"
      data-view-drag={draggedView ? "true" : undefined}
      onDragOver={onViewDragOver}
      onDragLeave={onViewDragLeave}
      onDrop={onViewDrop}
    >
      {layout.columns.map((column, ci) => (
        <Fragment key={column.id}>
          {ci > 0 && (
            <div
              className="split-h"
              data-active={drag?.kind === "h"}
              onPointerDown={(e) => {
                e.preventDefault();
                startColumnSplit(ci, e);
              }}
            />
          )}
          <div className="pane-col" style={{ flexGrow: column.size }}>
            {column.panes.map((pane, pi) => (
              <Fragment key={pane.id}>
                {pi > 0 && (
                  <div
                    className="split-v"
                    data-active={drag?.kind === "v"}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      startPaneSplit(column, pi, e);
                    }}
                  />
                )}
                <PaneView pane={pane} column={column} />
              </Fragment>
            ))}
          </div>
        </Fragment>
      ))}
      {draggedView && (
        <div className="ws-drop" aria-hidden="true">
          <div className="ws-drop-zone" data-active={dropSide === "left"}>
            <Columns3 size={17} />
            <span>Split left</span>
          </div>
          <div className="ws-drop-zone ws-drop-center" data-active={dropSide === "center"}>
            <Plus size={17} />
            <span>Open {PANE_META[draggedView].label}</span>
          </div>
          <div className="ws-drop-zone" data-active={dropSide === "right"}>
            <Columns3 size={17} />
            <span>Split right</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PaneView({ pane, column }: { pane: PaneRef; column: Column }) {
  const meta = PANE_META[pane.kind];
  const mobile = useIsMobile();
  const Icon = meta.icon;
  const calendarMode = useUI((s) => s.calendarMode);
  const setCalendarMode = useUI((s) => s.setCalendarMode);
  const tasksMode = useUI((s) => s.tasksMode);
  const setTasksMode = useUI((s) => s.setTasksMode);
  const selectedWorkProjectId = useUI((s) => s.selectedWorkProjectId);
  const setSelectedWorkProject = useUI((s) => s.setSelectedWorkProject);
  const setProjectCreateOpen = useUI((s) => s.setProjectCreateOpen);
  const workProjects = useWorkProjects();
  const selectedWorkProject = workProjects.find((p) => p.id === selectedWorkProjectId);
  const openCreate = useUI((s) => s.openCreate);
  const openEdit = useUI((s) => s.openEdit);
  const openGoalCreate = useUI((s) => s.openGoalCreate);
  const anchorDate = useUI((s) => s.anchorDate);
  const filterProjectId = useUI((s) => s.filterProjectId);
  const zoom = useUI((s) => s.calendarZoom[s.calendarMode]);
  const zoomIn = useUI((s) => s.zoomIn);
  const zoomOut = useUI((s) => s.zoomOut);
  const resetZoom = useUI((s) => s.resetZoom);
  const showHolidays = useUI((s) => s.showHolidays);
  const toggleHolidays = useUI((s) => s.toggleHolidays);

  const createEvent = () => {
    const start = sod(anchorDate) + 9 * 3_600_000;
    openCreate({ type: "event", title: "", start, end: start + 3_600_000 });
  };

  let actions: React.ReactNode = null;

  if (pane.kind === "calendar") {
    const percent = Math.round(zoom * 100);
    actions = (
      <>
        <div className="zoom-group" role="group" aria-label="Calendar zoom">
          <button
            className="icon-btn"
            title="Zoom out (−)"
            aria-label="Zoom out"
            onClick={() => zoomOut(calendarMode)}
          >
            <ZoomOut size={13} />
          </button>
          <button
            className="zoom-reset"
            title={`Zoom ${percent}% · reset to fit (0)`}
            aria-label={`Zoom ${percent} percent, reset to fit`}
            onClick={() => resetZoom(calendarMode)}
          >
            {percent}%
          </button>
          <button
            className="icon-btn"
            title="Zoom in (+)"
            aria-label="Zoom in"
            onClick={() => zoomIn(calendarMode)}
          >
            <ZoomIn size={13} />
          </button>
        </div>
        {mobile ? (
          // Five labelled buttons plus the zoom group do not fit a phone pane
          // head, and the actions after them would scroll out of reach.
          <Select
            value={calendarMode}
            options={CALENDAR_MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
            onChange={(value) => setCalendarMode(value as CalendarMode)}
            ariaLabel="Calendar view"
            className="cal-mode-select"
          />
        ) : (
          <div className="seg">
            {CALENDAR_MODES.map((mode) => (
              <Fragment key={mode.id}>
                {mode.separated && <span className="seg-sep" aria-hidden />}
                <button
                  data-active={calendarMode === mode.id}
                  onClick={() => setCalendarMode(mode.id)}
                  title={`${mode.label} (${mode.label[0]})`}
                  aria-label={`${mode.label} view`}
                  aria-pressed={calendarMode === mode.id}
                >
                  {mode.label[0]}
                </button>
              </Fragment>
            ))}
          </div>
        )}
        <button
          className="icon-btn"
          title={showHolidays ? "Hide US holidays" : "Show US holidays"}
          aria-pressed={showHolidays}
          data-active={showHolidays}
          onClick={() => toggleHolidays()}
        >
          <PartyPopper size={13} />
        </button>
        <button className="icon-btn" title="New event (E)" onClick={createEvent}>
          <Plus size={13} />
        </button>
      </>
    );
  } else if (pane.kind === "tasks") {
    actions = (
      <>
        <div className="seg">
          <button data-active={tasksMode === "list"} onClick={() => setTasksMode("list")} title="List">
            <List size={11} />
          </button>
          <button data-active={tasksMode === "board"} onClick={() => setTasksMode("board")} title="Board">
            <Columns3 size={11} />
          </button>
          <button
            data-active={tasksMode === "timeline"}
            onClick={() => setTasksMode("timeline")}
            title="Timeline"
          >
            <ChartGantt size={11} />
          </button>
        </div>
        <button
          className="icon-btn"
          title="New task (N)"
          onClick={() => openCreate({ type: "task", title: "", projectId: filterProjectId, priority: 0 })}
        >
          <Plus size={13} />
        </button>
      </>
    );
  } else if (pane.kind === "projects") {
    actions = selectedWorkProject ? (
      <button
        className="icon-btn"
        title="New project task"
        onClick={() =>
          openCreate({
            type: "task",
            title: "",
            projectId: selectedWorkProject.calendarId ?? null,
            workProjectId: selectedWorkProject.id,
            priority: 0,
          })
        }
      >
        <Plus size={13} />
      </button>
    ) : (
      <button
        className="icon-btn"
        title="New project"
        onClick={() => {
          setSelectedWorkProject(null);
          setProjectCreateOpen(true);
        }}
      >
        <Plus size={13} />
      </button>
    );
  } else if (pane.kind === "notes") {
    actions = (
      <button
        className="icon-btn"
        title="New note"
        onClick={async () => {
          const note = await createItem({ type: "note", title: "Untitled note", body: "" });
          openEdit(note.id, {
            type: "note",
            title: note.title,
            body: "",
          });
        }}
      >
        <Plus size={13} />
      </button>
    );
  } else if (pane.kind === "goals") {
    actions = (
      <button
        className="icon-btn"
        title="New goal (G)"
        onClick={() => openGoalCreate({ span: "month", projectId: filterProjectId })}
      >
        <Plus size={13} />
      </button>
    );
  } else if (pane.kind === "today") {
    actions = (
      <button className="icon-btn" title="New event" onClick={createEvent}>
        <Plus size={13} />
      </button>
    );
  } else if (pane.kind === "focus") {
    actions = (
      <button
        className="icon-btn"
        title="Start a 25 minute session"
        onClick={() => useUI.getState().startTimer(25, "focus", null)}
      >
        <Plus size={13} />
      </button>
    );
  }

  return (
    <PaneFrame
      pane={pane}
      title={meta.label}
      icon={<Icon size={12} />}
      actions={actions}
      // A phone always shows exactly one pane; there is nothing to close.
      canRemove={
        !mobile && (column.panes.length > 1 || useUI.getState().layout.columns.length > 1)
      }
    >
      {pane.kind === "calendar" && <CalendarView />}
      {pane.kind === "tasks" && <TaskPane />}
      {pane.kind === "habits" && <HabitsPane />}
      {pane.kind === "projects" && <ProjectsPane />}
      {pane.kind === "goals" && <GoalsPane />}
      {pane.kind === "today" && <TodayPane />}
      {pane.kind === "widgets" && <WidgetsPane />}
      {pane.kind === "notes" && <NotesPane />}
      {pane.kind === "focus" && <FocusPane />}
    </PaneFrame>
  );
}
