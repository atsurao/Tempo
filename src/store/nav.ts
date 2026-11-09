import { useUI, type PaneKind } from "./ui";
import { isMobileViewport } from "../hooks/useIsMobile";

/**
 * Rail clicks reveal a view: if it is already visible we keep the layout as-is,
 * a single-pane workspace swaps its content, otherwise the view joins as a column.
 */
export function useOpenView() {
  const layout = useUI((s) => s.layout);
  const setPaneKind = useUI((s) => s.setPaneKind);
  const addPane = useUI((s) => s.addPane);
  const setActiveView = useUI((s) => s.setActiveView);

  return (
    kind: PaneKind,
    options: { keepCalendarAnchor?: boolean } = {},
  ) => {
    // Opening the calendar is a fresh visit: return to the current week rather
    // than whatever week was left on screen. Collection links that point at a
    // particular calendar or schedule keep the date they just selected.
    if (kind === "calendar" && !options.keepCalendarAnchor) {
      const state = useUI.getState();
      state.setCalendarMode("week");
      state.goToday();
    }
    setActiveView(kind);
    const single = layout.columns.length === 1 && layout.columns[0].panes.length === 1;

    // Phones never split. A restored desktop layout collapses to one pane the
    // first time a tab is chosen, then every tab swaps that pane's content.
    if (isMobileViewport()) {
      if (single) {
        setPaneKind(layout.columns[0].panes[0].id, kind);
        return;
      }
      useUI.getState().openTodayFull();
      const paneId = useUI.getState().layout.columns[0]?.panes[0]?.id;
      if (paneId) useUI.getState().setPaneKind(paneId, kind);
      return;
    }

    const exists = layout.columns.some((c) => c.panes.some((p) => p.kind === kind));
    if (exists) return;
    if (single) setPaneKind(layout.columns[0].panes[0].id, kind);
    else addPane(kind);
  };
}
