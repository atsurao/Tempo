import { useRef, useState } from "react";
import { AlertCircle, Check, Download, Upload, X } from "lucide-react";
import { useItems } from "../../db/hooks";
import { useUI } from "../../store/ui";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { clockStamp } from "../../lib/clock";
import {
  BackupError,
  backupCounts,
  buildBackup,
  describeCounts,
  parseBackup,
  restoreBackup,
  type Backup,
  type BackupCounts,
  type RestoreMode,
} from "../../lib/backup";
import { saveTextFile } from "../../lib/desktop";

const MAX_BYTES = 100 * 1024 * 1024;

type Stage =
  | { kind: "idle" }
  | { kind: "ready"; fileName: string; backup: Backup; counts: BackupCounts }
  | { kind: "done"; mode: RestoreMode; counts: BackupCounts }
  | { kind: "error"; message: string };

/**
 * Export and restore for the settings dialog. A chosen file is parsed into
 * counts first, so "replace everything" is only ever one click after seeing
 * exactly what is about to land on this device.
 */
export function BackupRestore() {
  const items = useItems();
  const toast = useUI((s) => s.toast);
  const timeFormat = useTimeFormat();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStage({ kind: "idle" });
    if (fileRef.current) fileRef.current.value = "";
  };

  const exportBackup = async () => {
    setBusy(true);
    try {
      const { name, json } = await buildBackup();
      const path = await saveTextFile(json, name);
      toast(path ? `Backup saved to ${path}` : `Backup saved as ${name}`, {
        tone: "success",
      });
    } catch {
      setStage({ kind: "error", message: "The backup could not be written." });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setStage({ kind: "error", message: "That file is larger than 100 MB." });
      return;
    }
    try {
      const text = await file.text();
      const backup = parseBackup(text);
      setStage({
        kind: "ready",
        fileName: file.name,
        backup,
        counts: backupCounts(backup),
      });
    } catch (error) {
      setStage({
        kind: "error",
        message:
          error instanceof BackupError
            ? error.message
            : "That file could not be read as a backup.",
      });
    }
  };

  const restore = async (mode: RestoreMode) => {
    if (stage.kind !== "ready") return;
    setBusy(true);
    try {
      const counts = await restoreBackup(stage.backup, mode);
      setStage({ kind: "done", mode, counts });
      toast(
        mode === "replace"
          ? `Restored ${describeCounts(counts)}`
          : `Merged ${describeCounts(counts)}`,
        { tone: "success" },
      );
    } catch {
      setStage({ kind: "error", message: "The restore failed before it could finish." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="settings-row" data-setting="data-export">
        <span className="settings-label">{items.length} items stored</span>
        <div className="settings-control">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <button className="btn sm" disabled={busy} onClick={() => void exportBackup()}>
            <Download size={11} /> Export JSON
          </button>
          <button className="btn sm subtle" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload size={11} /> Import
          </button>
        </div>
      </div>

      {stage.kind === "idle" && (
        <div className="faint settings-hint">
          A backup is the only way to move everything to another device or back from
          a reinstall. Export writes a JSON file; import reads it back.
        </div>
      )}

      {stage.kind !== "idle" && (
        <div className="ics-panel">
          {stage.kind === "ready" && (
            <>
              <div className="ics-head">
                <span className="ics-name">{stage.fileName}</span>
                <span className="spacer" />
                <button className="icon-btn" onClick={reset} title="Cancel restore">
                  <X size={12} />
                </button>
              </div>
              <div className="ics-meta">{describeCounts(stage.counts)}</div>
              {stage.backup.exportedAt && (
                <div className="ics-meta">
                  Exported {clockStamp(stage.backup.exportedAt, timeFormat)}
                </div>
              )}
              <div className="ics-meta">
                Merge keeps what is here; replace makes this device match the file.
              </div>
              <div className="ics-actions">
                <button
                  className="btn sm primary"
                  disabled={busy}
                  onClick={() => void restore("merge")}
                >
                  {busy ? "Restoring…" : "Merge"}
                </button>
                <button
                  className="btn sm subtle"
                  disabled={busy}
                  title="Delete everything on this device and use the backup instead"
                  onClick={() => void restore("replace")}
                >
                  Replace everything
                </button>
                <button className="btn sm subtle" disabled={busy} onClick={reset}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {stage.kind === "done" && (
            <>
              <div className="ics-head">
                <span className="ics-name">
                  <Check size={11} /> {stage.mode === "replace" ? "Restored" : "Merged"}
                </span>
                <span className="spacer" />
                <button className="icon-btn" onClick={reset} title="Close">
                  <X size={12} />
                </button>
              </div>
              <div className="ics-meta">{describeCounts(stage.counts)}</div>
            </>
          )}

          {stage.kind === "error" && (
            <>
              <div className="ics-head">
                <span className="ics-name">
                  <AlertCircle size={11} /> Could not restore
                </span>
                <span className="spacer" />
                <button className="icon-btn" onClick={reset} title="Dismiss">
                  <X size={12} />
                </button>
              </div>
              <div className="ics-meta">{stage.message}</div>
              <div className="ics-actions">
                <button className="btn sm subtle" onClick={() => fileRef.current?.click()}>
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
