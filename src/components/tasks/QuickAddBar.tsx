import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowUpRight, CornerDownLeft } from "lucide-react";
import { parseQuickAdd } from "../../lib/nlp";
import { createFromText } from "../../lib/create";
import { clockTime } from "../../lib/clock";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { useProjects } from "../../db/hooks";
import { useUI } from "../../store/ui";
import type { Item } from "../../types";

interface Props {
  defaults?: Partial<Item>;
  placeholder?: string;
  autoFocus?: boolean;
  showPreview?: boolean;
  onCreated?: (item: Item, openEditor: boolean) => void;
}

export function QuickAddBar({
  defaults,
  placeholder = "Add a task…  read ch. 4 fri 2pm #reading !2",
  autoFocus,
  showPreview = true,
  onCreated,
}: Props) {
  const projects = useProjects();
  const toast = useUI((s) => s.toast);
  const timeFormat = useTimeFormat();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(
    () => (value.trim() ? parseQuickAdd(value, Date.now(), timeFormat) : null),
    [value, timeFormat],
  );

  const submit = async (openEditor: boolean) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      const item = await createFromText(value, projects, Date.now(), defaults);
      if (!item) return;
      setValue("");
      if (!openEditor) {
        const when =
          item.start != null
            ? ` · ${format(item.start, "EEE, MMM d")} · ${clockTime(item.start, timeFormat)}`
            : item.dueAt != null
              ? ` · due ${format(item.dueAt, "MMM d")}`
              : "";
        toast(`${item.type === "event" ? "Event" : item.type === "note" ? "Note" : "Task"} added${when}`);
      }
      onCreated?.(item, openEditor);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quick-add">
      <div className="quick-add-row">
        <input
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit(e.metaKey || e.ctrlKey);
            }
            if (e.key === "Escape") {
              setValue("");
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {value.trim() && (
          <button className="btn icon sm" title="Add (Enter)" onClick={() => void submit(false)}>
            <CornerDownLeft size={12} />
          </button>
        )}
      </div>
      {showPreview && parsed && (
        <div className="quick-add-preview">
          <span style={{ color: "var(--text-2)" }}>{parsed.type === "event" ? "Event" : "Task"}</span>
          {parsed.summary.map((s) => (
            <span key={s} className="chip">
              {s}
            </span>
          ))}
          {parsed.type === "event" && (
            <span className="row" style={{ gap: 2, color: "var(--accent-ink)" }}>
              <ArrowUpRight size={9} /> calendar
            </span>
          )}
        </div>
      )}
    </div>
  );
}
