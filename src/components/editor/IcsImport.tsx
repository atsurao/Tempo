import { useRef, useState } from "react";
import { AlertCircle, Check, Undo2, Upload, X } from "lucide-react";
import { format } from "date-fns";
import { useItems, useTags } from "../../db/hooks";
import {
  applyImport,
  planImport,
  undoImport,
  type ImportPlan,
  type ImportResult,
} from "../../lib/icsImport";

const MAX_BYTES = 20 * 1024 * 1024;

type Stage =
  | { kind: "idle" }
  | { kind: "ready"; fileName: string; plan: ImportPlan }
  | { kind: "done"; fileName: string; result: ImportResult; undone: boolean }
  | { kind: "nothing"; message: string }
  | { kind: "error"; message: string };

/**
 * The last batch of this session, so undo is still offered after the settings
 * dialog is closed and reopened. A reload forgets it, like any in-memory state.
 */
let lastBatch: { fileName: string; result: ImportResult; undone: boolean } | null = null;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

interface Totals {
  events: number;
  tasks: number;
}

function entryCount(totals: Totals): number {
  return totals.events + totals.tasks;
}

/** "42 events, 3 tasks" — only the parts that are non-zero. */
function describe(totals: Totals): string {
  const parts: string[] = [];
  if (totals.events) parts.push(plural(totals.events, "event"));
  if (totals.tasks) parts.push(plural(totals.tasks, "task"));
  return parts.join(", ");
}

function rangeText(plan: ImportPlan): string | null {
  if (plan.earliest == null || plan.latest == null) return null;
  const from = format(plan.earliest, "MMM d, yyyy");
  const to = format(plan.latest, "MMM d, yyyy");
  return from === to ? from : `${from} – ${to}`;
}

/**
 * Calendar import for the settings dialog. Picking a file parses it into a
 * plan first, so the confirmation shows real counts before anything is saved.
 */
export function IcsImport() {
  const items = useItems();
  const tags = useTags();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>(() =>
    lastBatch ? { kind: "done", ...lastBatch } : { kind: "idle" },
  );
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStage({ kind: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  };

  const pick = () => fileRef.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setStage({ kind: "error", message: "That file is larger than 20 MB." });
      return;
    }
    try {
      const text = await file.text();
      const plan = planImport(text, items);
      if (entryCount(plan.counts) === 0 && plan.rows.length === 0) {
        setStage(
          plan.counts.duplicates
            ? { kind: "nothing", message: `Everything in ${file.name} is already in Tempo.` }
            : { kind: "nothing", message: "No events or tasks found in this file." },
        );
        return;
      }
      setStage({ kind: "ready", fileName: file.name, plan });
    } catch {
      setStage({ kind: "error", message: "That file could not be read as a calendar." });
    }
  };

  const confirm = async () => {
    if (stage.kind !== "ready") return;
    setBusy(true);
    try {
      const result = await applyImport(stage.plan, tags);
      lastBatch = { fileName: stage.fileName, result, undone: false };
      setStage({ kind: "done", ...lastBatch });
    } catch {
      setStage({ kind: "error", message: "The import failed before it could finish." });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (stage.kind !== "done") return;
    setBusy(true);
    try {
      await undoImport(stage.result.ids);
      lastBatch = null;
      setStage({ ...stage, undone: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="settings-row" data-setting="data-ics">
        <span className="settings-label">Import calendar</span>
        <div className="settings-control">
          <input
            ref={fileRef}
            type="file"
            accept=".ics,text/calendar,application/ics"
            style={{ display: "none" }}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <button className="btn sm" onClick={pick}>
            <Upload size={11} /> Import .ics
          </button>
        </div>
      </div>

      {stage.kind === "idle" && (
        <div className="faint settings-hint">
          Bring in a calendar exported from Google, Apple, Outlook or Fastmail.
        </div>
      )}

      {stage.kind !== "idle" && (
        <div className="ics-panel">
          {stage.kind === "ready" && (
            <>
              <div className="ics-head">
                <span className="ics-name">
                  {stage.plan.calendarName ?? stage.fileName}
                </span>
                <span className="spacer" />
                <button className="icon-btn" onClick={reset} title="Cancel import">
                  <X size={12} />
                </button>
              </div>
              <div className="ics-meta">
                {describe(stage.plan.counts) || "Nothing new"}
                {stage.plan.counts.recurring > 0 && (
                  <> · {plural(stage.plan.counts.recurring, "repeating series", "repeating series")}</>
                )}
              </div>
              {rangeText(stage.plan) && <div className="ics-meta">{rangeText(stage.plan)}</div>}
              {stage.plan.counts.duplicates > 0 && (
                <div className="ics-meta">
                  {plural(stage.plan.counts.duplicates, "duplicate")} skipped
                </div>
              )}
              <div className="ics-actions">
                <button
                  className="btn sm primary"
                  disabled={busy || entryCount(stage.plan.counts) === 0}
                  onClick={() => void confirm()}
                >
                  {busy
                    ? "Importing…"
                    : entryCount(stage.plan.counts) > 0
                      ? `Import ${plural(entryCount(stage.plan.counts), "item")}`
                      : "Nothing to import"}
                </button>
                <button className="btn sm subtle" onClick={reset}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {stage.kind === "done" && (
            <>
              <div className="ics-head">
                <span className="ics-name">
                  <Check size={11} /> {stage.undone ? "Import undone" : "Imported"}
                </span>
                <span className="spacer" />
                <button className="icon-btn" onClick={reset} title="Close">
                  <X size={12} />
                </button>
              </div>
              <div className="ics-meta">
                {stage.undone
                  ? `${plural(entryCount(stage.result), "item")} removed`
                  : `${describe(stage.result)} from ${stage.result.calendarName ?? stage.fileName}`}
              </div>
              {!stage.undone && stage.result.tagNames.length > 0 && (
                <div className="ics-meta">
                  Added tags: {stage.result.tagNames.map((t) => `#${t}`).join(", ")}
                </div>
              )}
              {!stage.undone && (
                <div className="ics-actions">
                  <button className="btn sm subtle" disabled={busy} onClick={() => void undo()}>
                    <Undo2 size={11} /> Undo import
                  </button>
                </div>
              )}
            </>
          )}

          {(stage.kind === "error" || stage.kind === "nothing") && (
            <>
              <div className="ics-head">
                <span className="ics-name">
                  {stage.kind === "error" ? (
                    <>
                      <AlertCircle size={11} /> Could not import
                    </>
                  ) : (
                    <>
                      <Check size={11} /> Nothing new
                    </>
                  )}
                </span>
                <span className="spacer" />
                <button className="icon-btn" onClick={reset} title="Dismiss">
                  <X size={12} />
                </button>
              </div>
              <div className="ics-meta">{stage.message}</div>
              <div className="ics-actions">
                <button className="btn sm subtle" onClick={pick}>
                  Choose another file
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
