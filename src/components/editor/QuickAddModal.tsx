import { useUI } from "../../store/ui";
import { QuickAddBar } from "../tasks/QuickAddBar";
import { draftFromItem } from "../../lib/draft";

export function QuickAddModal() {
  const setOpen = useUI((s) => s.setQuickAddOpen);
  const openEdit = useUI((s) => s.openEdit);

  return (
    <div
      className="palette-backdrop"
      style={{ alignItems: "flex-start" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="palette" style={{ width: "min(520px, calc(100vw - 40px))" }}>
        <div style={{ padding: "10px 10px 0" }}>
          <div className="sheet-hint" style={{ padding: "0 2px 6px" }}>
            Quick add — dates, times, durations, #tags, !priority, @calendar
          </div>
          <QuickAddBar
            autoFocus
            placeholder="chem lab fri 2pm for 90m #school !3"
            onCreated={(item) => {
              setOpen(false);
              openEdit(item.id, draftFromItem(item));
            }}
          />
        </div>
        <div className="palette-foot">
          <span>enter to create</span>
          <span>esc to dismiss</span>
          <span className="spacer" />
          <span>⌘↵ to open the editor</span>
        </div>
      </div>
    </div>
  );
}
