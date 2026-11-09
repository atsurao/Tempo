import { useUI } from "../store/ui";
import type { TimeFormat } from "../lib/clock";

/** The reader's chosen clock, for components that print a time. */
export function useTimeFormat(): TimeFormat {
  return useUI((s) => s.timeFormat);
}
