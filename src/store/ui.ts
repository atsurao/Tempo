import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  GoalSpan,
  ItemType,
  Priority,
  Recurrence,
  Reminder,
  TaskStatus,
  TimeBlock,
} from "../types";
import type { CollectionHighlight } from "../lib/collectionFocus";
import { uid } from "../lib/id";
import { addDays, addMonths, addWeeks, addYears, sod } from "../lib/date";
import {
  DEFAULT_MOBILE_HIDDEN,
  DEFAULT_MOBILE_ORDER,
  DEFAULT_RAIL_ORDER,
  cleanHidden,
  normalizeOrder,
  toggleBarView,
} from "../lib/navPrefs";

export type PaneDropSide = "left" | "right";
export type PaneKind =
  | "today"
  | "widgets"
  | "calendar"
  | "tasks"
  | "habits"
  | "projects"
  | "goals"
  | "notes"
  | "focus";
export type CalendarMode = "year" | "month" | "week" | "day" | "agenda";
export type TasksMode = "list" | "board" | "timeline";
export type TaskSort = "default" | "due" | "priority" | "tag" | "title" | "created";

/** A modal yes/no question. The callback runs when the user confirms. */
export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}
export type ProjectsMode = "list" | "board" | "gantt";
export type CollectionMenuKind = "calendars" | "projects" | "schedules";
export type ThemeMode = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";
export type RadiusStyle = "soft" | "square" | "round";

/**
 * Zoom is kept per calendar view: a week zoomed out to fit is still a month
 * at its own comfortable size. 1 is the default and, for the week and day
 * grids, the fit-to-screen width.
 */
export const ZOOM_STEPS = [0.6, 0.7, 0.85, 1, 1.15, 1.35, 1.6, 2];
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
export type CalendarZoom = Record<CalendarMode, number>;
const DEFAULT_ZOOM: CalendarZoom = { year: 1, month: 1, week: 1, day: 1, agenda: 1 };

function stepZoom(value: number, dir: -1 | 1): number {
  const steps = dir > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse();
  const next = steps.find((s) => (dir > 0 ? s > value + 0.001 : s < value - 0.001));
  return next ?? (dir > 0 ? MAX_ZOOM : MIN_ZOOM);
}

export interface PaneRef {
  id: string;
  kind: PaneKind;
  size: number;
  title?: string;
}
export interface Column {
  id: string;
  panes: PaneRef[];
  size: number;
}
export interface Layout {
  columns: Column[];
}

export interface EditorDraft {
  type: ItemType;
  title?: string;
  body?: string;
  start?: number | null;
  end?: number | null;
  allDay?: boolean;
  dueAt?: number | null;
  /** Due on the day rather than at a time. */
  dueAllDay?: boolean;
  /** The task's calendar blocks, each with its own repeat rule. */
  timeblocks?: TimeBlock[];
  projectId?: string | null;
  /** Membership in a work project; separate from the calendar in `projectId`. */
  workProjectId?: string | null;
  tagIds?: string[];
  priority?: Priority;
  status?: TaskStatus;
  estimateMin?: number | null;
  parentId?: string | null;
  reminders?: Reminder[];
  recurrence?: Recurrence | null;
  location?: string;
  url?: string;
}

export interface EditorState {
  itemId?: string;
  /** set when editing one instance of a recurring series */
  occurrenceStart?: number;
  draft: EditorDraft;
}

/** Goals are edited in their own sheet; they share none of the item fields. */
export interface GoalDraft {
  title?: string;
  body?: string;
  span?: GoalSpan;
  start?: number;
  projectId?: string | null;
  color?: string | null;
}

export interface GoalEditorState {
  goalId?: string;
  draft: GoalDraft;
}

export interface Toast {
  id: string;
  message: string;
  actionLabel?: string;
  action?: () => void;
  tone?: "default" | "success" | "error";
}

export interface ScheduleOccurrenceTarget {
  scheduleId: string;
  sessionId: string;
  day: number;
}

export interface ContextMenuState {
  kind:
    | "item"
    | "calendar"
    | "workProject"
    | "schedule"
    | "scheduleOccurrence"
    | "slot"
    | "tag";
  /** Viewport coordinates of the pointer that opened the menu. */
  x: number;
  y: number;
  itemId?: string;
  projectId?: string;
  workProjectId?: string;
  scheduleId?: string;
  /** The weekly session and day behind a timetable occurrence menu. */
  scheduleItemId?: string;
  scheduleDay?: number;
  tagId?: string;
  /** Times of the occurrence that was clicked, when it is not the master row. */
  start?: number;
  end?: number;
  /** Series slot to edit or remove when the click was on one occurrence. */
  originalStart?: number;
  isDue?: boolean;
  /** For an empty calendar slot: the day is booked without a clock time. */
  allDay?: boolean;
}

export interface PostponeTarget {
  taskId: string;
  /** Viewport coordinates of the postpone button. */
  x: number;
  y: number;
}

export interface TimerState {
  running: boolean;
  endsAt: number | null;
  remainingSec: number;
  totalSec: number;
  mode: "focus" | "break";
  taskId: string | null;
  startedAt: number | null;
}

const pane = (kind: PaneKind, size = 100): PaneRef => ({ id: uid("pane"), kind, size });
const column = (panes: PaneRef[], size: number): Column => ({ id: uid("col"), panes, size });

export function presetLayout(preset: string): { id: string; layout: Layout } {
  switch (preset) {
    case "today":
      return { id: "today", layout: { columns: [column([pane("today")], 100)] } };
    case "focus":
      return { id: "focus", layout: { columns: [column([pane("today")], 100)] } };
    case "plan":
      return {
        id: "plan",
        layout: { columns: [column([pane("tasks")], 36), column([pane("calendar")], 64)] },
      };
    case "review":
      return {
        id: "review",
        layout: {
          columns: [column([pane("calendar")], 50), column([pane("tasks")], 50)],
        },
      };
    case "study":
      return {
        id: "study",
        layout: {
          columns: [column([pane("tasks")], 34), column([pane("calendar")], 42), column([pane("focus")], 24)],
        },
      };
    case "split":
    default:
      return {
        id: "split",
        layout: {
          columns: [column([pane("calendar")], 60), column([pane("tasks")], 40)],
        },
      };
  }
}

/** The sidebar can be dragged wider or narrower, but only inside this band. */
export const RAIL_MIN_WIDTH = 168;
export const RAIL_MAX_WIDTH = 360;
export const RAIL_DEFAULT_WIDTH = 216;

export const PRESETS = [
  { id: "today", label: "Today", hint: "One full-window today page" },
  { id: "split", label: "Calendar + Tasks", hint: "The default working view" },
  { id: "plan", label: "Plan", hint: "Tasks on the left, calendar on the right" },
  { id: "focus", label: "Focus", hint: "One pane, nothing else" },
  { id: "review", label: "Review", hint: "Calendar and tasks side by side" },
  { id: "study", label: "Study", hint: "Tasks, calendar and a timer" },
] as const;

interface UIState {
  theme: ThemeMode;
  accent: string;
  density: Density;
  radiusStyle: RadiusStyle;
  weekStart: 0 | 1;
  /** 12-hour AM/PM clocks or 24-hour clocks, everywhere times are printed. */
  timeFormat: "12h" | "24h";
  /** Overdue tasks stay visible even when their calendar is hidden. */
  keepOverdue: boolean;
  dayStartHour: number;
  dayEndHour: number;
  calendarZoom: CalendarZoom;

  railCollapsed: boolean;
  railWidth: number;
  /** Every desktop view, in sidebar order, including hidden ones. */
  railOrder: PaneKind[];
  /** Views left out of the desktop sidebar, still reachable from search. */
  railHidden: PaneKind[];
  /** Every view, in phone-bar order, including the ones under More. */
  mobileOrder: PaneKind[];
  /** Views kept out of the phone bar and listed under More. */
  mobileHidden: PaneKind[];

  layout: Layout;
  presetId: string;

  calendarMode: CalendarMode;
  tasksMode: TasksMode;
  /** Ordering inside each task group. */
  taskSort: TaskSort;
  projectsMode: ProjectsMode;
  /** Work project being edited in the project dialog. */
  projectEditId: string | null;
  /** US holidays and observances drawn in the calendar. */
  showHolidays: boolean;
  confirm: ConfirmRequest | null;
  /** The work project whose detail is open; null shows the project index. */
  selectedWorkProjectId: string | null;
  /** The new-project form in the Projects pane. */
  projectCreateOpen: boolean;
  /** Calendar groups folded shut in the task list, by group key. */
  collapsedGroups: string[];
  anchorDate: number;
  /** Bumped by Today so a view can refocus even when the date is unchanged. */
  todayPulse: number;
  filterProjectId: string | null;
  /** A tag selected in the task toolbar or the desktop rail. */
  filterTagId: string | null;
  activeView: PaneKind;

  editor: EditorState | null;
  goalEditor: GoalEditorState | null;
  contextMenu: ContextMenuState | null;
  /** The overdue task whose date menu is open, if any. */
  postponeMenu: PostponeTarget | null;
  /** A card-style picker for calendars, projects or schedules. */
  collectionMenu: CollectionMenuKind | null;
  /** The project task open in the delegation card. */
  delegationTaskId: string | null;
  /** The project whose roster is open in the team dialog. */
  teamProjectId: string | null;
  /** Calendar items lit up briefly after a collection is chosen. */
  collectionHighlight: CollectionHighlight | null;
  calendarSettingsId: string | null;
  calendarDeleteId: string | null;
  /** The fixed weekly schedule open in its own editor, if any. */
  scheduleEditorId: string | null;
  /** The schedule awaiting a delete confirmation, if any. */
  scheduleDeleteId: string | null;
  /** The single timetable occurrence open in its one-off editor, if any. */
  scheduleOccurrence: ScheduleOccurrenceTarget | null;
  /** The schedule whose breaks are listed through the year, if any. */
  breaksOverviewId: string | null;
  paletteOpen: boolean;
  quickAddOpen: boolean;
  settingsOpen: boolean;
  /** First-run setup, or the wizard replayed from Settings. Never persisted. */
  onboardingOpen: boolean;
  onboardingReplay: boolean;
  searchQuery: string;
  toasts: Toast[];

  timer: TimerState;
  notified: Record<string, number>;

  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  setAccent: (a: string) => void;
  setDensity: (d: Density) => void;
  setRadius: (r: RadiusStyle) => void;
  setWeekStart: (w: 0 | 1) => void;
  setTimeFormat: (format: "12h" | "24h") => void;
  setKeepOverdue: (keep: boolean) => void;
  setDayHours: (start: number, end: number) => void;
  setZoom: (mode: CalendarMode, value: number) => void;
  zoomIn: (mode: CalendarMode) => void;
  zoomOut: (mode: CalendarMode) => void;
  resetZoom: (mode: CalendarMode) => void;

  toggleRail: () => void;
  setRailCollapsed: (collapsed: boolean) => void;
  setRailWidth: (width: number) => void;
  setRailOrder: (order: PaneKind[]) => void;
  toggleRailView: (id: PaneKind) => void;
  setMobileOrder: (order: PaneKind[]) => void;
  toggleMobileView: (id: PaneKind) => void;
  resetNavigation: () => void;

  applyPreset: (id: string) => void;
  openTodayFull: () => void;
  setColumnSize: (id: string, size: number) => void;
  setPaneSize: (columnId: string, paneId: string, size: number) => void;
  setPaneKind: (paneId: string, kind: PaneKind) => void;
  setPaneTitle: (paneId: string, title: string) => void;
  addPane: (kind: PaneKind) => void;
  addPaneAt: (kind: PaneKind, side: PaneDropSide) => void;
  removePane: (paneId: string) => void;
  setFilterProject: (id: string | null) => void;
  setFilterTag: (id: string | null) => void;
  setActiveView: (kind: PaneKind) => void;

  setCalendarMode: (m: CalendarMode) => void;
  setTasksMode: (m: TasksMode) => void;
  setTaskSort: (sort: TaskSort) => void;
  openProjectEdit: (id: string) => void;
  closeProjectEdit: () => void;
  toggleHolidays: (show?: boolean) => void;
  askConfirm: (request: ConfirmRequest) => void;
  closeConfirm: () => void;
  setProjectsMode: (m: ProjectsMode) => void;
  setSelectedWorkProject: (id: string | null) => void;
  setProjectCreateOpen: (open: boolean) => void;
  toggleGroupCollapsed: (key: string) => void;
  setAnchor: (ts: number) => void;
  goToday: () => void;
  shift: (dir: -1 | 1) => void;

  openCreate: (draft: EditorDraft) => void;
  openEdit: (itemId: string, draft: EditorDraft, occurrenceStart?: number) => void;
  closeEditor: () => void;
  openGoalCreate: (draft: GoalDraft) => void;
  openGoalEdit: (goalId: string, draft: GoalDraft) => void;
  closeGoalEditor: () => void;
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
  openPostponeMenu: (taskId: string, x: number, y: number) => void;
  closePostponeMenu: () => void;
  setCollectionMenu: (menu: CollectionMenuKind | null) => void;
  setDelegationTask: (id: string | null) => void;
  setTeamProject: (id: string | null) => void;
  highlightCollection: (kind: CollectionHighlight["kind"], id: string) => void;
  clearCollectionHighlight: () => void;
  setCalendarSettings: (id: string | null) => void;
  setCalendarDelete: (id: string | null) => void;
  setScheduleEditor: (id: string | null) => void;
  setScheduleDelete: (id: string | null) => void;
  setScheduleOccurrence: (target: ScheduleOccurrenceTarget | null) => void;
  setBreaksOverview: (id: string | null) => void;
  setPaletteOpen: (v: boolean) => void;
  setQuickAddOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  openOnboarding: (replay?: boolean) => void;
  closeOnboarding: () => void;
  setSearchQuery: (q: string) => void;

  toast: (message: string, opts?: Omit<Toast, "id" | "message">) => void;
  dismissToast: (id: string) => void;

  startTimer: (minutes: number, mode: "focus" | "break", taskId?: string | null) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  resetTimer: () => void;
  setTimerTask: (taskId: string | null) => void;

  markNotified: (key: string) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      accent: "#4f46e5",
      density: "comfortable",
      radiusStyle: "soft",
      weekStart: 0,
      timeFormat: "12h",
      keepOverdue: false,
      dayStartHour: 7,
      dayEndHour: 23,
      calendarZoom: { ...DEFAULT_ZOOM },

      railCollapsed: false,
      railWidth: RAIL_DEFAULT_WIDTH,
      railOrder: [...DEFAULT_RAIL_ORDER],
      railHidden: [],
      mobileOrder: [...DEFAULT_MOBILE_ORDER],
      mobileHidden: [...DEFAULT_MOBILE_HIDDEN],

      layout: presetLayout("split").layout,
      presetId: "split",

      calendarMode: "week",
      tasksMode: "list",
      taskSort: "default",
      projectsMode: "list",
      projectEditId: null,
      showHolidays: true,
      confirm: null,
      selectedWorkProjectId: null,
      projectCreateOpen: false,
      collapsedGroups: [],
      anchorDate: sod(Date.now()),
      todayPulse: 0,
      filterProjectId: null,
      filterTagId: null,
      activeView: "calendar",

      editor: null,
      goalEditor: null,
      contextMenu: null,
      postponeMenu: null,
      collectionMenu: null,
      delegationTaskId: null,
      teamProjectId: null,
      collectionHighlight: null,
      calendarSettingsId: null,
      calendarDeleteId: null,
      scheduleEditorId: null,
      scheduleDeleteId: null,
      scheduleOccurrence: null,
      breaksOverviewId: null,
      paletteOpen: false,
      quickAddOpen: false,
      settingsOpen: false,
      onboardingOpen: false,
      onboardingReplay: false,
      searchQuery: "",
      toasts: [],
      notified: {},

      timer: {
        running: false,
        endsAt: null,
        remainingSec: 25 * 60,
        totalSec: 25 * 60,
        mode: "focus",
        taskId: null,
        startedAt: null,
      },

      setTheme: (theme) => set({ theme }),
      toggleTheme: () => {
        const { theme } = get();
        const resolved =
          theme === "system"
            ? window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light"
            : theme;
        set({ theme: resolved === "dark" ? "light" : "dark" });
      },
      setAccent: (accent) => set({ accent }),
      setDensity: (density) => set({ density }),
      setRadius: (radiusStyle) => set({ radiusStyle }),
      setWeekStart: (weekStart) => set({ weekStart }),
      setTimeFormat: (timeFormat) => set({ timeFormat }),
      setKeepOverdue: (keepOverdue) => set({ keepOverdue }),
      setDayHours: (dayStartHour, dayEndHour) => set({ dayStartHour, dayEndHour }),
      setZoom: (mode, value) =>
        set((s) => ({
          calendarZoom: {
            ...s.calendarZoom,
            [mode]: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)),
          },
        })),
      zoomIn: (mode) =>
        set((s) => ({
          calendarZoom: { ...s.calendarZoom, [mode]: stepZoom(s.calendarZoom[mode] ?? 1, 1) },
        })),
      zoomOut: (mode) =>
        set((s) => ({
          calendarZoom: { ...s.calendarZoom, [mode]: stepZoom(s.calendarZoom[mode] ?? 1, -1) },
        })),
      resetZoom: (mode) =>
        set((s) => ({ calendarZoom: { ...s.calendarZoom, [mode]: 1 } })),

      toggleRail: () => set({ railCollapsed: !get().railCollapsed }),
      setRailCollapsed: (railCollapsed) => set({ railCollapsed }),
      setRailWidth: (width) =>
        set({ railWidth: Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, Math.round(width))) }),
      setRailOrder: (railOrder) => set({ railOrder }),
      toggleRailView: (id) =>
        set((s) => ({
          railHidden: s.railHidden.includes(id)
            ? s.railHidden.filter((view) => view !== id)
            : [...s.railHidden, id],
        })),
      setMobileOrder: (mobileOrder) => set({ mobileOrder }),
      toggleMobileView: (id) =>
        set((s) => {
          const mobileHidden = toggleBarView(s.mobileOrder, s.mobileHidden, id);
          return mobileHidden ? { mobileHidden } : {};
        }),
      resetNavigation: () =>
        set({
          railOrder: [...DEFAULT_RAIL_ORDER],
          railHidden: [],
          mobileOrder: [...DEFAULT_MOBILE_ORDER],
          mobileHidden: [...DEFAULT_MOBILE_HIDDEN],
        }),

      applyPreset: (id) => {
        const { layout } = presetLayout(id);
        set({ layout, presetId: id });
      },
      openTodayFull: () => {
        const { layout } = presetLayout("today");
        set({ layout, presetId: "today", activeView: "today", filterProjectId: null });
      },
      setColumnSize: (id, size) =>
        set((s) => ({
          layout: {
            columns: s.layout.columns.map((c) => (c.id === id ? { ...c, size } : c)),
          },
        })),
      setPaneSize: (columnId, paneId, size) =>
        set((s) => ({
          layout: {
            columns: s.layout.columns.map((c) =>
              c.id === columnId
                ? { ...c, panes: c.panes.map((p) => (p.id === paneId ? { ...p, size } : p)) }
                : c,
            ),
          },
        })),
      setPaneKind: (paneId, kind) =>
        set((s) => ({
          layout: {
            columns: s.layout.columns.map((c) => ({
              ...c,
              panes: c.panes.map((p) => (p.id === paneId ? { ...p, kind } : p)),
            })),
          },
        })),
      addPane: (kind) =>
        set((s) => {
          const count = s.layout.columns.length;
          const newSize = count === 0 ? 100 : 100 / (count + 1);
          const scale = (100 - newSize) / 100;
          return {
            layout: {
              columns: [
                ...s.layout.columns.map((c) => ({ ...c, size: c.size * scale })),
                column([pane(kind)], newSize),
              ],
            },
            presetId: "custom",
          };
        }),
      addPaneAt: (kind, side) =>
        set((s) => {
          if (s.layout.columns.length === 0) {
            return {
              layout: { columns: [column([pane(kind)], 100)] },
              presetId: "custom",
            };
          }
          // A side drop claims half the window; the existing columns divide
          // the other half in their current proportions.
          const columns = s.layout.columns.map((c) => ({ ...c, size: c.size * 0.5 }));
          const next = column([pane(kind)], 50);
          return {
            layout: {
              columns: side === "left" ? [next, ...columns] : [...columns, next],
            },
            presetId: "custom",
          };
        }),
      removePane: (paneId) =>
        set((s) => {
          const columns = s.layout.columns
            .map((c) => ({ ...c, panes: c.panes.filter((p) => p.id !== paneId) }))
            .filter((c) => c.panes.length > 0);
          if (columns.length === 0) return { layout: presetLayout("split").layout, presetId: "split" };
          const total = columns.reduce((sum, c) => sum + c.size, 0) || 1;
          return {
            layout: { columns: columns.map((c) => ({ ...c, size: (c.size / total) * 100 })) },
            presetId: "custom",
          };
        }),

      setPaneTitle: (paneId, title) =>
        set((s) => ({
          layout: {
            columns: s.layout.columns.map((c) => ({
              ...c,
              panes: c.panes.map((p) => (p.id === paneId ? { ...p, title } : p)),
            })),
          },
        })),
      setFilterProject: (filterProjectId) =>
        set((s) => ({
          filterProjectId,
          // A calendar and a tag are two different lenses on the same task
          // page. Choosing one clears the other instead of stacking an
          // invisible second filter on top of the result.
          filterTagId: filterProjectId ? null : s.filterTagId,
        })),
      setFilterTag: (filterTagId) =>
        set((s) => ({
          filterTagId,
          filterProjectId: filterTagId ? null : s.filterProjectId,
        })),
      setActiveView: (activeView) => set({ activeView }),

      setCalendarMode: (calendarMode) => set({ calendarMode }),
      setTasksMode: (tasksMode) => set({ tasksMode }),
      setTaskSort: (taskSort) => set({ taskSort }),
      openProjectEdit: (projectEditId) => set({ projectEditId }),
      closeProjectEdit: () => set({ projectEditId: null }),
      toggleHolidays: (show) =>
        set((s) => ({ showHolidays: show ?? !s.showHolidays })),
      askConfirm: (confirm) => set({ confirm }),
      closeConfirm: () => set({ confirm: null }),
      setProjectsMode: (projectsMode) => set({ projectsMode }),
      setSelectedWorkProject: (selectedWorkProjectId) => set({ selectedWorkProjectId }),
      setProjectCreateOpen: (projectCreateOpen) => set({ projectCreateOpen }),
      toggleGroupCollapsed: (key) =>
        set((s) => ({
          collapsedGroups: s.collapsedGroups.includes(key)
            ? s.collapsedGroups.filter((k) => k !== key)
            : [...s.collapsedGroups, key],
        })),
      setAnchor: (anchorDate) => set({ anchorDate: sod(anchorDate) }),
      goToday: () =>
        set((s) => ({ anchorDate: sod(Date.now()), todayPulse: s.todayPulse + 1 })),
      shift: (dir) => {
        const { calendarMode, anchorDate } = get();
        const base = new Date(anchorDate);
        const next =
          calendarMode === "day"
            ? addDays(base, dir)
            : calendarMode === "week"
              ? addWeeks(base, dir)
              : calendarMode === "year"
                ? addYears(base, dir)
                : addMonths(base, dir);
        set({ anchorDate: sod(next.getTime()) });
      },

      openCreate: (draft) => set({ editor: { draft }, paletteOpen: false }),
      openEdit: (itemId, draft, occurrenceStart) =>
        set({ editor: { itemId, draft, occurrenceStart }, paletteOpen: false }),
      closeEditor: () => set({ editor: null }),
      openGoalCreate: (draft) =>
        set({ goalEditor: { draft }, paletteOpen: false, quickAddOpen: false }),
      openGoalEdit: (goalId, draft) =>
        set({ goalEditor: { goalId, draft }, paletteOpen: false, quickAddOpen: false }),
      closeGoalEditor: () => set({ goalEditor: null }),
      openContextMenu: (contextMenu) => set({ contextMenu }),
      closeContextMenu: () => set({ contextMenu: null }),
      openPostponeMenu: (taskId, x, y) => set({ postponeMenu: { taskId, x, y } }),
      closePostponeMenu: () => set({ postponeMenu: null }),
      setCollectionMenu: (collectionMenu) => set({ collectionMenu }),
      setDelegationTask: (delegationTaskId) => set({ delegationTaskId }),
      setTeamProject: (teamProjectId) => set({ teamProjectId }),
      highlightCollection: (kind, id) =>
        set({
          collectionHighlight: {
            kind,
            id,
            nonce: Date.now(),
            expiresAt: Date.now() + 5000,
          },
        }),
      clearCollectionHighlight: () => set({ collectionHighlight: null }),
      setCalendarSettings: (calendarSettingsId) => set({ calendarSettingsId }),
      setScheduleEditor: (scheduleEditorId) => set({ scheduleEditorId }),
      setScheduleDelete: (scheduleDeleteId) => set({ scheduleDeleteId }),
      setScheduleOccurrence: (scheduleOccurrence) => set({ scheduleOccurrence }),
      setBreaksOverview: (breaksOverviewId) => set({ breaksOverviewId }),
      setCalendarDelete: (calendarDeleteId) => set({ calendarDeleteId }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      openOnboarding: (replay = false) =>
        set({ onboardingOpen: true, onboardingReplay: replay, settingsOpen: false }),
      closeOnboarding: () => set({ onboardingOpen: false, onboardingReplay: false }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setQuickAddOpen: (quickAddOpen) => set({ quickAddOpen }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),

      toast: (message, opts) =>
        set((s) => ({
          toasts: [...s.toasts.slice(-3), { id: uid("toast"), message, ...opts }],
        })),
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      startTimer: (minutes, mode, taskId) =>
        set({
          timer: {
            running: true,
            endsAt: Date.now() + minutes * 60_000,
            remainingSec: minutes * 60,
            totalSec: minutes * 60,
            mode,
            taskId: taskId ?? null,
            startedAt: Date.now(),
          },
        }),
      pauseTimer: () => {
        const { timer } = get();
        if (!timer.running || !timer.endsAt) return;
        const remainingSec = Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000));
        set({ timer: { ...timer, running: false, remainingSec, endsAt: null } });
      },
      resumeTimer: () => {
        const { timer } = get();
        if (timer.running) return;
        set({
          timer: {
            ...timer,
            running: true,
            endsAt: Date.now() + timer.remainingSec * 1000,
            startedAt: timer.startedAt ?? Date.now(),
          },
        });
      },
      resetTimer: () =>
        set((s) => ({
          timer: { ...s.timer, running: false, endsAt: null, remainingSec: s.timer.totalSec },
        })),
      setTimerTask: (taskId) => set((s) => ({ timer: { ...s.timer, taskId } })),

      markNotified: (key) =>
        set((s) => ({ notified: { ...s.notified, [key]: Date.now() } })),
    }),
    {
      name: "tempo-ui",
      version: 8,
      migrate: (persisted, version) => {
        const state = persisted as Partial<UIState>;
        // v2 made dark the default appearance.
        if (version < 2) state.theme = "dark";
        // v3 moved the default week start from Monday to Sunday.
        if (version < 3) state.weekStart = 0;
        // v4 added the Goals view; put it where a saved rail order expects it.
        if (version < 4) {
          const order = state.railOrder ?? [];
          if (order.length === 0) state.railOrder = DEFAULT_RAIL_ORDER;
          else if (!order.includes("goals")) {
            const at = order.indexOf("tasks");
            state.railOrder = [...order.slice(0, at + 1), "goals", ...order.slice(at + 1)];
          }
        }
        // v5 gave each calendar view its own zoom, defaulting to fit.
        if (version < 5) {
          state.calendarZoom = { ...DEFAULT_ZOOM, ...(state.calendarZoom ?? {}) };
        }
        // v6 added Projects; put it after Tasks in a saved rail order.
        if (version < 6) {
          const order = state.railOrder ?? [];
          if (order.length === 0) state.railOrder = DEFAULT_RAIL_ORDER;
          else if (!order.includes("projects")) {
            const at = order.indexOf("tasks");
            state.railOrder = [...order.slice(0, at + 1), "projects", ...order.slice(at + 1)];
          }
        }
        // v7 added Habits and the 12/24-hour clock. Put Habits after Tasks.
        if (version < 7) {
          const order = state.railOrder ?? [];
          if (order.length === 0) state.railOrder = DEFAULT_RAIL_ORDER;
          else if (!order.includes("habits")) {
            const at = order.indexOf("tasks");
            state.railOrder = [...order.slice(0, at + 1), "habits", ...order.slice(at + 1)];
          }
          state.timeFormat = state.timeFormat === "24h" ? "24h" : "12h";
        }
        // v8 made navigation customizable per device. Older installs keep the
        // tabs and rail they already had: everything shown, default order.
        if (version < 8) {
          state.railOrder = normalizeOrder(state.railOrder);
          state.railHidden = cleanHidden(state.railHidden);
          state.mobileOrder = normalizeOrder(state.mobileOrder);
          state.mobileHidden = cleanHidden(state.mobileHidden ?? DEFAULT_MOBILE_HIDDEN);
        }
        return state as UIState;
      },
      partialize: (s) => ({
        theme: s.theme,
        accent: s.accent,
        density: s.density,
        radiusStyle: s.radiusStyle,
        weekStart: s.weekStart,
        timeFormat: s.timeFormat,
        keepOverdue: s.keepOverdue,
        dayStartHour: s.dayStartHour,
        dayEndHour: s.dayEndHour,
        calendarZoom: s.calendarZoom,
        railCollapsed: s.railCollapsed,
        railWidth: s.railWidth,
        railOrder: s.railOrder,
        railHidden: s.railHidden,
        mobileOrder: s.mobileOrder,
        mobileHidden: s.mobileHidden,
        layout: s.layout,
        presetId: s.presetId,
        calendarMode: s.calendarMode,
        tasksMode: s.tasksMode,
        taskSort: s.taskSort,
        showHolidays: s.showHolidays,
        projectsMode: s.projectsMode,
        selectedWorkProjectId: s.selectedWorkProjectId,
        collapsedGroups: s.collapsedGroups,
        timer: s.timer,
        notified: s.notified,
      }),
    },
  ),
);
