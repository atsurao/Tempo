import { useEffect, useLayoutEffect, useState } from "react";
import { AppBar } from "./components/shell/AppBar";
import { SideRail } from "./components/shell/SideRail";
import { PaneLayout } from "./components/shell/PaneLayout";
import { StatusBar } from "./components/shell/StatusBar";
import { Toasts } from "./components/shell/Toasts";
import { ItemEditor } from "./components/editor/ItemEditor";
import { GoalEditor } from "./components/editor/GoalEditor";
import { CommandPalette } from "./components/editor/CommandPalette";
import { QuickAddModal } from "./components/editor/QuickAddModal";
import { SettingsModal } from "./components/editor/SettingsModal";
import { CalendarDialogs } from "./components/editor/CalendarDialogs";
import { ScheduleEditor } from "./components/editor/ScheduleEditor";
import { BreaksOverview } from "./components/editor/BreaksOverview";
import { ScheduleOccurrenceEditor } from "./components/editor/ScheduleOccurrenceEditor";
import { ContextMenu } from "./components/shell/ContextMenu";
import { PostponeMenu } from "./components/tasks/PostponeMenu";
import { CollectionMenu } from "./components/shell/CollectionMenu";
import { TaskDelegation } from "./components/projects/TaskDelegation";
import { ProjectTeamDialog } from "./components/projects/ProjectTeamDialog";
import { ProjectEditDialog } from "./components/projects/ProjectEditDialog";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { useUI } from "./store/ui";
import { useReminders } from "./hooks/useReminders";
import { openExternal } from "./lib/desktop";
import { seedOnce } from "./db/seed";
import { Splash } from "./components/shell/Splash";
import { Onboarding } from "./components/onboarding/Onboarding";
import { primeAutoBackup } from "./lib/autoBackup";
import { primeAutoSync } from "./lib/sync/autoSync";
import { needsSetup, readShowSplash } from "./lib/appSettings";
import { sod } from "./lib/date";
import { scrollCalendar } from "./lib/calendarScroll";
import { MobileTabs } from "./components/shell/MobileTabs";
import { useIsMobile } from "./hooks/useIsMobile";
import { useLongPressMenus } from "./hooks/useLongPress";

function contrastOn(hex: string): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#ffffff";
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.55 ? "#141412" : "#ffffff";
}

function useAppearance() {
  const theme = useUI((s) => s.theme);
  const accent = useUI((s) => s.accent);
  const density = useUI((s) => s.density);
  const radiusStyle = useUI((s) => s.radiusStyle);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-fg", contrastOn(accent));
  }, [accent]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  useEffect(() => {
    document.documentElement.dataset.radius = radiusStyle;
  }, [radiusStyle]);
}

/**
 * Links in notes and item bodies belong in the user's browser. The desktop
 * webview would otherwise navigate away from the app (or, for target=_blank,
 * do nothing at all), so every http(s) click is routed through the shell.
 */
function useExternalLinks() {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.closest("a[href]") : null;
      const href = target?.getAttribute("href") ?? "";
      if (!target || !/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      void openExternal(href);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);
}

function useGlobalShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      const state = useUI.getState();

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        state.setPaletteOpen(!state.paletteOpen);
        return;
      }

      if (e.key === "Escape") {
        if (state.settingsOpen) state.setSettingsOpen(false);
        else if (state.postponeMenu) state.closePostponeMenu();
        else if (state.scheduleOccurrence) state.setScheduleOccurrence(null);
        else if (state.breaksOverviewId) state.setBreaksOverview(null);
        else if (state.scheduleEditorId) state.setScheduleEditor(null);
        else if (state.goalEditor) state.closeGoalEditor();
        else if (state.paletteOpen) state.setPaletteOpen(false);
        else if (state.quickAddOpen) state.setQuickAddOpen(false);
        else if (state.editor) state.closeEditor();
        return;
      }

      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      const modalOpen =
        state.settingsOpen ||
        state.paletteOpen ||
        state.quickAddOpen ||
        !!state.editor ||
        !!state.goalEditor ||
        !!state.contextMenu ||
        !!state.postponeMenu ||
        !!state.collectionMenu ||
        !!state.delegationTaskId ||
        !!state.teamProjectId ||
        state.calendarSettingsId != null ||
        state.calendarDeleteId != null ||
        state.scheduleEditorId != null ||
        state.scheduleDeleteId != null ||
        state.scheduleOccurrence != null ||
        state.breaksOverviewId != null;
      if (modalOpen) return;

      // Calendar keys only mean something when a calendar pane is on screen.
      const hasCalendar = state.layout.columns.some((c) =>
        c.panes.some((p) => p.kind === "calendar"),
      );
      if (hasCalendar) {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          state.shift(e.key === "ArrowLeft" ? -1 : 1);
          return;
        }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          scrollCalendar(e.key === "ArrowUp" ? "up" : "down");
          return;
        }
        if (e.key === "PageUp" || e.key === "PageDown") {
          e.preventDefault();
          scrollCalendar(e.key === "PageUp" ? "up" : "down", true);
          return;
        }
        if (e.key === "Home") {
          e.preventDefault();
          state.goToday();
          return;
        }
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          state.zoomIn(state.calendarMode);
          return;
        }
        if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          state.zoomOut(state.calendarMode);
          return;
        }
        if (e.key === "0") {
          e.preventDefault();
          state.resetZoom(state.calendarMode);
          return;
        }
      }

      switch (e.key.toLowerCase()) {
        case "n":
          e.preventDefault();
          state.openCreate({
            type: "task",
            title: "",
            priority: 0,
            projectId: state.filterProjectId,
            workProjectId:
              state.activeView === "projects" ? state.selectedWorkProjectId : null,
          });
          break;
        case "e": {
          e.preventDefault();
          const start = sod(state.anchorDate) + 9 * 3_600_000;
          state.openCreate({ type: "event", title: "", start, end: start + 3_600_000 });
          break;
        }
        case "q":
          e.preventDefault();
          state.setQuickAddOpen(true);
          break;
        case "g":
          e.preventDefault();
          state.openGoalCreate({ span: "month", projectId: state.filterProjectId });
          break;
        case "t":
          e.preventDefault();
          state.goToday();
          break;
        case "[":
          e.preventDefault();
          state.shift(-1);
          break;
        case "]":
          e.preventDefault();
          state.shift(1);
          break;
        case "d":
          if (!hasCalendar) break;
          e.preventDefault();
          state.setCalendarMode("day");
          break;
        case "w":
          if (!hasCalendar) break;
          e.preventDefault();
          state.setCalendarMode("week");
          break;
        case "m":
          if (!hasCalendar) break;
          e.preventDefault();
          state.setCalendarMode("month");
          break;
        case "y":
          if (!hasCalendar) break;
          e.preventDefault();
          state.setCalendarMode("year");
          break;
        case "a":
          if (!hasCalendar) break;
          e.preventDefault();
          state.setCalendarMode("agenda");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}

/**
 * The calendar opens on the week that holds today, scaled so all seven days
 * fit the pane. The anchor is not persisted, so a launch already starts at
 * today; the mode and the zoom are, and restoring them would put back whatever
 * was on screen last time — a week zoomed past its own width, or a month grid.
 */
function useCalendarStart() {
  const setCalendarMode = useUI((s) => s.setCalendarMode);
  const resetZoom = useUI((s) => s.resetZoom);

  useLayoutEffect(() => {
    setCalendarMode("week");
    resetZoom("week");
  }, [setCalendarMode, resetZoom]);
}

export default function App() {
  const mobile = useIsMobile();
  useAppearance();
  useCalendarStart();
  useExternalLinks();
  useGlobalShortcuts();
  useReminders();
  useLongPressMenus(mobile);

  const editor = useUI((s) => s.editor);
  const goalEditor = useUI((s) => s.goalEditor);
  const paletteOpen = useUI((s) => s.paletteOpen);
  const quickAddOpen = useUI((s) => s.quickAddOpen);
  const settingsOpen = useUI((s) => s.settingsOpen);
  const scheduleEditorId = useUI((s) => s.scheduleEditorId);
  const scheduleOccurrence = useUI((s) => s.scheduleOccurrence);
  const breaksOverviewId = useUI((s) => s.breaksOverviewId);
  const contextMenu = useUI((s) => s.contextMenu);
  const closeContextMenu = useUI((s) => s.closeContextMenu);
  const postponeMenu = useUI((s) => s.postponeMenu);
  const closePostponeMenu = useUI((s) => s.closePostponeMenu);
  const openTodayFull = useUI((s) => s.openTodayFull);

  // Launch lands on the day itself, full width, regardless of the last layout;
  // every layout stays one click away in the layout menu.
  useLayoutEffect(() => {
    openTodayFull();
  }, [openTodayFull]);

  // Launch sequence: decide whether this is a fresh install, fill a new
  // workspace or leave it blank, then show the welcome card (or setup).
  const [ready, setReady] = useState(false);
  const [splash, setSplash] = useState(false);
  const onboardingOpen = useUI((s) => s.onboardingOpen);
  const onboardingReplay = useUI((s) => s.onboardingReplay);
  const closeOnboarding = useUI((s) => s.closeOnboarding);

  useEffect(() => {
    let alive = true;
    void (async () => {
      let fresh = false;
      try {
        fresh = await needsSetup();
      } catch {
        fresh = false;
      }
      if (!alive) return;
      if (fresh) useUI.getState().openOnboarding(false);
      else await seedOnce();

      let showSplash = true;
      try {
        showSplash = await readShowSplash();
      } catch {
        showSplash = true;
      }
      if (!alive) return;
      setReady(true);
      setSplash(showSplash && !fresh);
      if (!fresh) {
        void primeAutoBackup();
        primeAutoSync();
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="app" data-mobile={mobile ? "true" : undefined}>
      <AppBar />
      <div className="app-body">
        {!mobile && <SideRail />}
        <PaneLayout />
      </div>
      {mobile ? <MobileTabs /> : <StatusBar />}
      {editor && <ItemEditor key={editor.itemId ?? "new"} />}
      {goalEditor && <GoalEditor key={goalEditor.goalId ?? "new-goal"} />}
      {paletteOpen && <CommandPalette />}
      {quickAddOpen && <QuickAddModal />}
      {settingsOpen && <SettingsModal />}
      {/* Both sheets can name the same schedule, and two siblings sharing a key
          makes React keep one of them mounted for good. */}
      {scheduleEditorId && <ScheduleEditor key={`editor:${scheduleEditorId}`} id={scheduleEditorId} />}
      {scheduleOccurrence && (
        <ScheduleOccurrenceEditor
          key={`occ:${scheduleOccurrence.sessionId}:${scheduleOccurrence.day}`}
        />
      )}
      {breaksOverviewId && <BreaksOverview key={`breaks:${breaksOverviewId}`} id={breaksOverviewId} />}
      <CollectionMenu />
      <TaskDelegation />
      <ProjectTeamDialog />
      <ProjectEditDialog />
      <ConfirmDialog />
      {/* On a phone the menus are bottom sheets. A real scrim keeps the tap
          that dismisses one off the calendar underneath; closing on pointerdown
          unmounts the scrim early and lets WebKit deliver the click through. */}
      {mobile && (contextMenu || postponeMenu) && (
        <button
          type="button"
          className="ctx-scrim"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            closeContextMenu();
            closePostponeMenu();
          }}
        />
      )}
      <ContextMenu />
      <PostponeMenu />
      <CalendarDialogs />
      {onboardingOpen ? (
        <Onboarding replay={onboardingReplay} onClose={closeOnboarding} />
      ) : (
        ready && splash && <Splash onClose={() => setSplash(false)} />
      )}
      <Toasts />
    </div>
  );
}
