import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { History, RotateCcw, Search, X } from "lucide-react";
import { useUI } from "../../store/ui";
import { readBackupConfig } from "../../lib/appSettings";
import {
  isDesktop,
  listBackupHistory,
  readBackupSnapshot,
  type HistoryEntry,
} from "../../lib/desktop";
import { snapshotNow } from "../../lib/autoBackup";
import {
  BackupError,
  backupCounts,
  describeCounts,
  parseBackup,
  restoreBackup,
  type Backup,
  type BackupCounts,
} from "../../lib/backup";
import { filterHistory, historySummary } from "../../lib/backupHistory";
import { clockStamp, clockTime } from "../../lib/clock";

interface Preview {
  entry: HistoryEntry;
  backup: Backup;
  counts: BackupCounts;
}

/**
 * Two weeks of timestamped snapshots, kept beside the rolling autosave. The
 * search covers the names inside each snapshot as well as its date, so a row
 * can be found by the work it contains ("organic") or the moment ("Tuesday").
 */
export function BackupHistory() {
  const timeFormat = useUI((s) => s.timeFormat);
  const toast = useUI((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isDesktop()) {
        setEntries([]);
        setError("Backup history lives in the desktop app.");
        return;
      }
      const config = await readBackupConfig();
      if (!config.folder) {
        setEntries([]);
        setError("Choose a backup folder first, then Tempo will keep history here.");
        return;
      }
      setEntries(await listBackupHistory(config.folder));
    } catch {
      setError("The backup history could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const shown = useMemo(() => filterHistory(entries, query), [entries, query]);

  const openSnapshot = async (entry: HistoryEntry) => {
    setBusy(true);
    setError(null);
    try {
      const config = await readBackupConfig();
      if (!config.folder) throw new Error("no folder");
      const text = await readBackupSnapshot(config.folder, entry.path);
      const backup = parseBackup(text);
      setPreview({ entry, backup, counts: backupCounts(backup) });
    } catch (cause) {
      setError(
        cause instanceof BackupError
          ? cause.message
          : "That snapshot could not be read.",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveSnapshot = async () => {
    setBusy(true);
    setError(null);
    try {
      const receipt = await snapshotNow();
      if (!receipt) {
        setError("Turn automatic backups on to keep a snapshot.");
        return;
      }
      toast("Snapshot saved", { tone: "success" });
      await load();
    } catch {
      setError("A snapshot could not be written.");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!preview) return;
    const { entry, backup } = preview;
    setBusy(true);
    setError(null);
    try {
      // Keep the workspace that is about to be replaced, so this is undoable.
      // If even this copy cannot be written, the restore does not start.
      const safety = await snapshotNow().catch(() => null);
      if (!safety) {
        setError(
          "A copy of the current workspace could not be saved, so nothing was restored.",
        );
        return;
      }
      const counts = await restoreBackup(backup, "replace");
      setPreview(null);
      toast(`Restored ${describeCounts(counts)} from ${clockStamp(entry.writtenAt, timeFormat)}`, {
        tone: "success",
      });
      await load();
    } catch {
      setError("That snapshot could not be restored.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backup-history" data-setting="data-history">
      <div className="backup-history-head">
        <div className="backup-head-text">
          <span className="settings-label">Backup history</span>
          <span className="backup-history-sub">
            Hourly snapshots, kept for two weeks
          </span>
        </div>
        <button
          className="btn sm subtle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <History size={11} /> {open ? "Hide" : "Browse"}
        </button>
      </div>

      {open && (
        <>
          <div className="history-tools">
            <div className="history-search">
              <Search size={11} className="history-search-icon" />
              <input
                className="input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search names, dates or times"
                aria-label="Search backup history"
              />
            </div>
            <button
              className="btn sm subtle"
              disabled={busy || loading}
              onClick={() => void saveSnapshot()}
              title="Keep a snapshot of the workspace as it is now"
            >
              Snapshot now
            </button>
          </div>

          {error && (
            <div className="backup-history-note" data-tone="warn">
              {error}
            </div>
          )}

          {loading ? (
            <div className="backup-history-note">Reading history…</div>
          ) : shown.length === 0 ? (
            <div className="backup-history-note">
              {entries.length === 0
                ? "No snapshots yet. One is kept when you edit, at most once an hour."
                : `No snapshots match “${query.trim()}”.`}
            </div>
          ) : (
            <div className="history-list">
              {shown.map((entry) => (
                <div className="history-row" key={entry.path}>
                  <div className="history-when">
                    <span>{format(entry.writtenAt, "EEE d MMM")}</span>
                    <span className="faint">{clockTime(entry.writtenAt, timeFormat)}</span>
                  </div>
                  <div className="history-meta">
                    <span>{historySummary(entry)}</span>
                    <span className="history-titles">
                      {entry.titles.slice(0, 3).join(" · ") || "No names indexed"}
                    </span>
                  </div>
                  <button
                    className="btn sm subtle"
                    disabled={busy}
                    onClick={() => void openSnapshot(entry)}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}

          {preview && (
            <div className="history-preview">
              <div className="history-preview-head">
                <RotateCcw size={12} />
                <span>Restore {clockStamp(preview.entry.writtenAt, timeFormat)}?</span>
                <span className="spacer" />
                <button
                  className="icon-btn"
                  disabled={busy}
                  onClick={() => setPreview(null)}
                  title="Cancel restore"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="backup-history-note">
                {describeCounts(preview.counts)}
              </div>
              <div className="backup-history-note">
                Every current calendar, task, note and habit is replaced. The snapshot being
                replaced is kept first, so you can come back to it.
              </div>
              <div className="ics-actions">
                <button
                  className="btn sm primary"
                  disabled={busy}
                  onClick={() => void restore()}
                >
                  {busy ? "Restoring…" : "Restore snapshot"}
                </button>
                <button
                  className="btn sm subtle"
                  disabled={busy}
                  onClick={() => setPreview(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
