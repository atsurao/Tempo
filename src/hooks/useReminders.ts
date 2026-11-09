import { useEffect } from "react";
import { useItems } from "../db/hooks";
import { useUI } from "../store/ui";
import { buildOccurrences } from "../lib/occurrences";
import { sendSystemNotification } from "../lib/notify";

/**
 * In-app reminder queue. This is the source of truth; system notifications are
 * best effort on top of it. Runs every 30 seconds and only fires once per
 * occurrence + reminder.
 */
export function useReminders() {
  const items = useItems();
  const toast = useUI((s) => s.toast);
  const notified = useUI((s) => s.notified);
  const markNotified = useUI((s) => s.markNotified);

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const occurrences = buildOccurrences(items, now - 60_000, now + 26 * 3_600_000);
      for (const occ of occurrences) {
        if (occ.isDue) continue;
        for (const reminder of occ.item.reminders ?? []) {
          const fireAt = occ.start - reminder.offsetMin * 60_000;
          if (fireAt > now || now - fireAt > 5 * 60_000) continue;
          const key = `${occ.key}:${reminder.id}`;
          if (notified[key]) continue;
          markNotified(key);
          const when =
            reminder.offsetMin === 0
              ? "starting now"
              : `in ${reminder.offsetMin >= 60 ? `${Math.round(reminder.offsetMin / 60)}h` : `${reminder.offsetMin}m`}`;
          toast(`${occ.item.title || "Untitled"} — ${when}`);
          sendSystemNotification(occ.item.title || "Tempo", `Starting ${when}`);
        }
      }
    };

    check();
    const id = window.setInterval(check, 30_000);
    return () => window.clearInterval(id);
  }, [items, notified, toast, markNotified]);
}
