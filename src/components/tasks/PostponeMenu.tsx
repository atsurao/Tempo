import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";
import { SheetDragHandle } from "../ui/SheetDragHandle";
import { addDays, format } from "date-fns";
import { CalendarClock, CalendarDays } from "lucide-react";
import { useItems } from "../../db/hooks";
import { updateItem } from "../../db/db";
import { useUI } from "../../store/ui";
import { shortDate, sod } from "../../lib/date";
import { postponedDueAt } from "../../lib/postpone";

/** A small, anchored menu for moving an overdue task to another day. */
export function PostponeMenu() {
  const target = useUI((s) => s.postponeMenu);
  const close = useUI((s) => s.closePostponeMenu);
  const toast = useUI((s) => s.toast);
  const items = useItems();
  const mobile = useIsMobile();
  const task = items.find((item) => item.id === target?.taskId && !item.deletedAt);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const quickDays = useMemo(() => {
    const today = sod(Date.now());
    return [
      { label: "Tomorrow", day: addDays(new Date(today), 1).getTime() },
      { label: "In 3 days", day: addDays(new Date(today), 3).getTime() },
      { label: "Next week", day: addDays(new Date(today), 7).getTime() },
    ];
  }, [target?.taskId]);

  useEffect(() => {
    if (!target) return;
    const onPointerDown = (event: PointerEvent) => {
      // On a phone the scrim owns outside taps. Closing during pointerdown
      // would remove that scrim before WebKit delivers the following click.
      if (mobile) return;
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [target, close, mobile]);

  useLayoutEffect(() => {
    if (!target) {
      setPos(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    setPos({
      left: Math.min(Math.max(8, target.x), Math.max(8, window.innerWidth - width - 8)),
      top:
        target.y + height + 8 > window.innerHeight
          ? Math.max(8, window.innerHeight - height - 8)
          : target.y + 8,
    });
  }, [target]);

  if (!target || !task || task.dueAt == null) return null;

  const sheetHandle = (
    <SheetDragHandle sheetRef={ref} enabled={mobile} onDismiss={close} />
  );

  const moveTo = (day: number) => {
    const next = postponedDueAt(task, day);
    if (next == null) return;
    const previous = task.dueAt;
    void (async () => {
      await updateItem(task.id, { dueAt: next });
      toast(`Postponed to ${format(next, "EEE, MMM d")}`, {
        actionLabel: "Undo",
        action: () => void updateItem(task.id, { dueAt: previous }),
      });
      close();
    })();
  };

  const pickDate = (value: string) => {
    if (!value) return;
    const day = new Date(`${value}T00:00`).getTime();
    if (Number.isFinite(day)) moveTo(day);
  };

  return (
    <div
      ref={ref}
      className="ctx postpone-menu"
      role="menu"
      aria-label={`Postpone ${task.title || "task"}`}
      style={{
        left: pos?.left ?? target.x,
        top: pos?.top ?? target.y,
        visibility: pos ? "visible" : "hidden",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {sheetHandle}
      <div className="ctx-head">
        <CalendarClock size={13} style={{ color: "var(--accent-ink)", flex: "none" }} />
        <span className="ctx-name">Postpone “{task.title || "Untitled"}”</span>
      </div>
      <div className="postpone-due">Was due {shortDate(task.dueAt)}</div>

      {quickDays.map((option) => (
        <button
          key={option.label}
          className="ctx-item"
          role="menuitem"
          onClick={() => moveTo(option.day)}
        >
          <CalendarDays size={13} />
          {option.label}
          <span className="spacer" />
          <span className="postpone-date">{format(option.day, "MMM d")}</span>
        </button>
      ))}

      <div className="ctx-sep" />
      <label className="postpone-pick">
        <span className="ctx-label">Pick a date</span>
        <input
          className="input"
          type="date"
          defaultValue={format(task.dueAt, "yyyy-MM-dd")}
          onChange={(e) => pickDate(e.target.value)}
          aria-label="New due date"
        />
      </label>
    </div>
  );
}
