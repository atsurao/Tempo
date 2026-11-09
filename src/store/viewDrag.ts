import { create } from "zustand";
import type { PaneKind } from "./ui";

interface ViewDragState {
  kind: PaneKind | null;
  begin: (kind: PaneKind) => void;
  end: () => void;
}

/**
 * A sidebar drag can end either back on the rail (reorder) or over the
 * workspace (open a pane). The rail and workspace are separate trees, so the
 * current view lives here rather than being threaded through app props.
 */
export const useViewDrag = create<ViewDragState>((set) => ({
  kind: null,
  begin: (kind) => set({ kind }),
  end: () => set({ kind: null }),
}));
