import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Download, RotateCcw, Trash2, X } from "lucide-react";
import { useItems } from "../../db/hooks";
import { clearAllData } from "../../db/db";
import { useUI } from "../../store/ui";
import { buildBackup } from "../../lib/backup";
import { saveTextFile } from "../../lib/desktop";

/** What has to be typed in the second window before anything is deleted. */
const CONFIRM_WORD = "RESET";

type Stage = "closed" | "warning" | "final";

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Factory reset for the local database. It is deliberately two dialogs: the
 * first says exactly what will go, and the second needs the word RESET typed
 * by hand. Closing either one leaves every row untouched.
 */
export function ResetData() {
  const items = useItems();
  const [stage, setStage] = useState<Stage>("closed");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const close = () => {
    if (busy) return;
    setStage("closed");
    setTyped("");
    setError(null);
    setSaveNote(null);
  };

  // Capture on the document so Escape closes this sheet, not the whole
  // Settings dialog behind it.
  useEffect(() => {
    if (stage === "closed") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [stage, busy]);

  useEffect(() => {
    if (stage !== "final") return;
    const frame = window.requestAnimationFrame(() => confirmRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [stage]);

  const saveCopy = async () => {
    setSaving(true);
    setSaveNote(null);
    try {
      const { name, json } = await buildBackup();
      const path = await saveTextFile(json, name);
      setSaveNote(path ? `Saved to ${path}` : `Saved as ${name}`);
    } catch {
      setSaveNote("The backup could not be written.");
    } finally {
      setSaving(false);
    }
  };

  const erase = async () => {
    if (busy || typed.trim().toUpperCase() !== CONFIRM_WORD) return;
    setBusy(true);
    setError(null);
    try {
      await clearAllData();
    } catch {
      setBusy(false);
      setError("Tempo could not clear the database. Nothing was reset; try again.");
      return;
    }
    try {
      // Appearance, layout and the focus timer live in localStorage, outside
      // the database; a factory reset has to take them too.
      useUI.persist.clearStorage();
    } catch {
      /* the workspace is already gone; a stale preference is not worth failing */
    }
    // A reload is the cleanest way to forget every in-memory view, count and
    // layout; it lands on first-run setup because the settings are gone too.
    window.location.reload();
  };

  return (
    <div className="reset-block">
      <div className="settings-row" data-setting="data-reset">
        <span className="settings-label">Reset all data</span>
        <div className="settings-control">
          <button className="btn sm danger" onClick={() => setStage("warning")}>
            <RotateCcw size={11} /> Reset…
          </button>
        </div>
      </div>
      <div className="faint settings-hint">
        Deletes everything on this device and reopens setup. Export a backup first if you may
        want it back.
      </div>

      {stage !== "closed" &&
        createPortal(
          <div
            className="modal-backdrop reset-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            {stage === "warning" ? (
              <div
                className="modal reset-modal"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="reset-title"
              >
                <div className="modal-head">
                  <span className="modal-title row" id="reset-title" style={{ gap: 7 }}>
                    <AlertTriangle size={15} style={{ color: "var(--danger)" }} /> Reset all
                    data?
                  </span>
                  <span className="spacer" />
                  <button className="icon-btn" title="Close" onClick={close}>
                    <X size={15} />
                  </button>
                </div>

                <div className="modal-body">
                  <div className="reset-lead">
                    This permanently deletes <strong>{plural(items.length, "item")}</strong> and
                    everything connected to them from the local database.
                  </div>
                  <ul className="reset-list">
                    <li>Calendars, tasks, events and notes</li>
                    <li>Projects, goals, habits and their history</li>
                    <li>Focus sessions, schedules and tags</li>
                    <li>Preferences, layout and the backup folder</li>
                  </ul>
                  <div className="reset-warn">
                    This cannot be undone. Tempo will reopen setup with an empty workspace.
                    Backup files already saved to disk are not touched.
                  </div>
                  <div className="reset-save">
                    <button
                      className="btn sm subtle"
                      disabled={saving || busy}
                      onClick={() => void saveCopy()}
                    >
                      <Download size={11} /> {saving ? "Saving…" : "Save a backup first"}
                    </button>
                    {saveNote && <span className="reset-save-note">{saveNote}</span>}
                  </div>
                </div>

                <div className="dlg-foot">
                  <span className="spacer" />
                  <button className="btn sm" onClick={close} autoFocus>
                    Cancel
                  </button>
                  <button className="btn sm danger" onClick={() => setStage("final")}>
                    Continue
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="modal reset-modal"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="reset-final-title"
              >
                <div className="modal-head">
                  <span className="modal-title row" id="reset-final-title" style={{ gap: 7 }}>
                    <AlertTriangle size={15} style={{ color: "var(--danger)" }} /> Delete
                    everything?
                  </span>
                  <span className="spacer" />
                  <button className="icon-btn" title="Close" onClick={close} disabled={busy}>
                    <X size={15} />
                  </button>
                </div>

                <div className="modal-body">
                  <div className="reset-lead">
                    Last check. This wipes every row in Tempo on this device, including your
                    preferences and layout, then reopens setup.
                  </div>
                  <label className="field">
                    <span className="field-label">Type {CONFIRM_WORD} to confirm</span>
                    <input
                      ref={confirmRef}
                      className="input"
                      value={typed}
                      placeholder={CONFIRM_WORD}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={busy}
                      onChange={(event) => setTyped(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void erase();
                      }}
                    />
                  </label>
                  {error && <div className="reset-error">{error}</div>}
                </div>

                <div className="dlg-foot">
                  <span className="spacer" />
                  <button className="btn sm" disabled={busy} onClick={() => setStage("warning")}>
                    Back
                  </button>
                  <button
                    className="btn sm danger-solid"
                    disabled={busy || typed.trim().toUpperCase() !== CONFIRM_WORD}
                    onClick={() => void erase()}
                  >
                    <Trash2 size={11} /> {busy ? "Resetting…" : "Delete everything"}
                  </button>
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
