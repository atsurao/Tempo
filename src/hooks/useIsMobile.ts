import { useSyncExternalStore } from "react";

/**
 * The phone shell is for touch-sized viewports, including an iPhone in
 * landscape. A coarse pointer plus a laptop-sized window stays desktop; an
 * iPad with a trackpad can still use the full multi-pane workspace.
 */
export const MOBILE_QUERY = "(max-width: 760px), (pointer: coarse) and (max-width: 1100px)";

function media(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(MOBILE_QUERY);
}

export function isMobileViewport(): boolean {
  return media()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const query = media();
  if (!query) return () => undefined;
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

function snapshot(): boolean {
  return media()?.matches ?? false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
