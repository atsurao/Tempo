import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Check, Target, Trash2, X } from "lucide-react";
import type { GoalSpan } from "../../types";
import { PALETTE } from "../../types";
import { useUI, type GoalDraft } from "../../store/ui";
import { useGoals, useProjects } from "../../db/hooks";
import { createGoal, restoreGoal, setGoalDone, softDeleteGoal, updateGoal } from "../../db/db";
import { GOAL_SPANS, goalDateLabel, goalEnd, goalTimeLabel, isGoalDone } from "../../lib/goals";
import { sod } from "../../lib/date";
import { Select } from "../ui/Select";

function dateValue(ts?: number | null): string {
  return ts ? format(ts, "yyyy-MM-dd") : "";
}

/**
 * Goals get their own sheet instead of a fourth tab in the item editor: a goal
 * carries a span and a horizon, but none of the item fields (times, reminders,
 * recurrence, priority) apply to it.
 */
export function GoalEditor() {
  const editor = useUI((s) => s.goalEditor);
  const closeGoalEditor = useUI((s) => s.closeGoalEditor);
  const toast = useUI((s) => s.toast);
  const projects = useProjects();
  const goals = useGoals();

  const [draft, setDraft] = useState<GoalDraft | null>(editor?.draft ?? null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(editor?.draft ?? null);
  }, [editor]);

  useEffect(() => {
    if (editor && !editor.goalId) {
      const id = window.setTimeout(() => titleRef.current?.focus(), 40);
      return () => window.clearTimeout(id);
    }
  }, [editor]);

  const existing = useMemo(
    () => (editor?.goalId ? goals.find((g) => g.id === editor.goalId) : undefined),
    [editor, goals],
  );

  if (!editor || !draft) return null;

  const patch = (p: Partial<GoalDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const span: GoalSpan = draft.span ?? "month";
  const start = draft.start ?? sod(Date.now());
  const horizon = goalEnd(span, start);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const title = draft.title?.trim() || "Untitled goal";
      if (editor.goalId) {
        await updateGoal(editor.goalId, {
          title,
          body: draft.body ?? "",
          span,
          start,
          projectId: draft.projectId ?? null,
          color: draft.color ?? null,
        });
        toast("Goal saved");
      } else {
        await createGoal({
          title,
          body: draft.body ?? "",
          span,
          start,
          projectId: draft.projectId ?? null,
          color: draft.color ?? null,
        });
        toast("Goal added", { tone: "success" });
      }
      closeGoalEditor();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    await softDeleteGoal(existing.id);
    closeGoalEditor();
    toast(`Deleted “${existing.title}”`, {
      actionLabel: "Undo",
      action: () => void restoreGoal(existing.id),
    });
  };

  const toggleDone = async () => {
    if (!existing) return;
    const done = isGoalDone(existing);
    await setGoalDone(existing.id, !done);
    closeGoalEditor();
    toast(done ? "Goal reopened" : `Completed “${existing.title}”`, { tone: "success" });
  };

  return (
    <div className="sheet" role="dialog" aria-label="Goal editor">
      <div className="sheet-head">
        <div className="sheet-type">
          <button data-active="true">
            <Target size={11} />
            Goal
          </button>
        </div>
        <div className="spacer" />
        <button className="icon-btn" onClick={closeGoalEditor} title="Close (Esc)">
          <X size={14} />
        </button>
      </div>

      <div className="sheet-body">
        <input
          ref={titleRef}
          className="sheet-title"
          value={draft.title ?? ""}
          placeholder="What are you working towards?"
          onChange={(e) => patch({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          }}
        />

        <div className="field">
          <span className="field-label">How long</span>
          <div className="scope-row">
            {GOAL_SPANS.map((option) => (
              <button
                key={option.id}
                data-active={span === option.id}
                title={option.hint}
                onClick={() => patch({ span: option.id })}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
            {horizon == null
              ? "No end date — the goal runs until you mark it done."
              : `Ends ${format(horizon, "MMMM d, yyyy")}`}
          </span>
        </div>

        <div className="field">
          <span className="field-label">Starts</span>
          <div className="sheet-grid">
            <input
              type="date"
              value={dateValue(start)}
              onChange={(e) => {
                if (!e.target.value) return;
                // Keep the day boundary: goals are whole-day ranges.
                patch({ start: sod(new Date(`${e.target.value}T12:00`).getTime()) });
              }}
            />
            <Select
              value={draft.projectId ?? ""}
              placeholder="No calendar"
              ariaLabel="Calendar"
              options={[
                { value: "", label: "No calendar" },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
              onChange={(v) => patch({ projectId: v || null })}
            />
          </div>
        </div>

        <div className="field">
          <span className="field-label">Color</span>
          <div className="swatches">
            <button
              className="swatch"
              data-active={!draft.color}
              style={{ background: "var(--surface-3)" }}
              title="Use the calendar color"
              aria-label="Use the calendar color"
              onClick={() => patch({ color: null })}
            />
            {PALETTE.map((color) => (
              <button
                key={color}
                className="swatch"
                style={{ background: color }}
                data-active={draft.color === color}
                title={color}
                aria-label={`Use ${color}`}
                onClick={() => patch({ color })}
              />
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Notes</span>
          <textarea
            value={draft.body ?? ""}
            placeholder="Why this matters, what done looks like…"
            onChange={(e) => patch({ body: e.target.value })}
            style={{ minHeight: 110 }}
          />
        </label>
      </div>

      <div className="sheet-foot">
        {existing && (
          <>
            <button className="btn sm" onClick={() => void toggleDone()}>
              <Check size={12} />
              {isGoalDone(existing) ? "Reopen" : "Mark done"}
            </button>
            <button className="btn sm danger" onClick={() => void remove()}>
              <Trash2 size={12} /> Delete
            </button>
          </>
        )}
        <div className="spacer" />
        <span className="sheet-hint">
          {existing
            ? `${goalDateLabel(existing)} · ${goalTimeLabel(existing)}`
            : "⌘↵ to save"}
        </span>
        <button className="btn" onClick={closeGoalEditor}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {editor.goalId ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );
}
