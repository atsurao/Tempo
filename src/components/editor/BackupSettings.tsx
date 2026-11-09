import { useEffect, useState } from "react";
import { FolderOpen, HardDrive, Save } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { Switch } from "../ui/Switch";
import { useUI } from "../../store/ui";
import {
  defaultBackupFolder,
  isDesktop,
  isIOS,
  pickBackupFolder,
  revealPath,
} from "../../lib/desktop";
import {
  DEFAULT_BACKUP,
  readBackupConfig,
  writeBackupConfig,
  type BackupConfig,
} from "../../lib/appSettings";
import {
  autoBackupState,
  flushAutoBackup,
  subscribeAutoBackup,
  type AutoBackupState,
} from "../../lib/autoBackup";
import { BackupHistory } from "./BackupHistory";

function statusText(config: BackupConfig, status: AutoBackupState): string {
  if (!config.enabled) return "Off";
  if (!config.folder) return "No folder chosen";
  if (!isDesktop()) return "Desktop app only";
  if (status.status === "saving") return "Saving…";
  if (status.status === "error") return status.error ?? "The backup failed";
  if (status.status === "pending") return "Waiting for edits to settle";
  if (status.lastAt) {
    return `Saved ${formatDistanceToNowStrict(status.lastAt, { addSuffix: true })}`;
  }
  return "Waiting for the first change";
}

/** Automatic backup controls, plus the way back into the setup wizard. */
export function BackupSettings() {
  const [config, setConfig] = useState<BackupConfig>(DEFAULT_BACKUP);
  const [status, setStatus] = useState<AutoBackupState>(autoBackupState());
  const [fallback, setFallback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const openOnboarding = useUI((s) => s.openOnboarding);

  useEffect(() => subscribeAutoBackup(setStatus), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [saved, defaultFolder] = await Promise.all([
        readBackupConfig(),
        defaultBackupFolder(),
      ]);
      if (!alive) return;
      setConfig(saved);
      setFallback(defaultFolder);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const update = async (patch: Partial<BackupConfig>) => {
    const next = await writeBackupConfig(patch);
    setConfig(next);
  };

  const choose = async () => {
    setNote(null);
    try {
      const picked = await pickBackupFolder();
      if (!picked) {
        if (!isDesktop()) setNote("Folder choice is available in the desktop app.");
        return;
      }
      await update({ folder: picked, enabled: true });
      void flushAutoBackup("manual");
    } catch {
      setNote("The folder picker could not open.");
    }
  };

  const saveNow = async () => {
    setBusy(true);
    setNote(null);
    await flushAutoBackup("manual");
    setBusy(false);
  };

  const lastPath = status.path ?? config.lastPath;
  const folderLine = config.folder ?? fallback ?? "No folder chosen";
  const phone = isIOS();

  return (
    <div className="backup-card" data-setting="data-backups">
      <div className="backup-head">
        <div className="backup-head-text">
          <span className="settings-label">Automatic backups</span>
          <span className="backup-status" data-state={status.status}>
            {statusText(config, status)}
          </span>
        </div>
        <Switch
          checked={config.enabled}
          label="Back up automatically after edits"
          onChange={(on) => {
            void update({ enabled: on });
            if (on) void flushAutoBackup("manual");
          }}
        />
      </div>

      <div className="backup-folder">
        <HardDrive size={13} className="backup-folder-icon" />
        <div className="backup-folder-body">
          <span className="onboarding-label">Backup folder</span>
          <span className="backup-folder-path" title={folderLine}>
            {folderLine}
          </span>
        </div>
        {!phone && (
          <button className="btn sm" onClick={() => void choose()}>
            <FolderOpen size={11} /> Choose…
          </button>
        )}
      </div>

      <div className="backup-actions">
        <button
          className="btn sm subtle"
          disabled={busy || !config.folder || !config.enabled}
          onClick={() => void saveNow()}
        >
          <Save size={11} /> {busy ? "Saving…" : "Back up now"}
        </button>
        {lastPath && isDesktop() && !phone && (
          <button
            className="btn sm subtle"
            onClick={() => {
              void revealPath(lastPath).catch(() => setNote("That file is no longer there."));
            }}
          >
            Show file
          </button>
        )}
        {!phone && fallback && config.folder !== fallback && (
          <button className="btn sm subtle" onClick={() => void update({ folder: fallback })}>
            Use default
          </button>
        )}
      </div>

      <div className="faint settings-hint">
        One file, <code>tempo-autosave.json</code>, rewritten about eight seconds after a burst of
        edits, with the previous copy kept beside it. It is readable only by your account.
      </div>

      {phone && (
        <div className="faint settings-hint">
          Backups live in Tempo's Documents folder. Open the Files app → On My iPhone →
          Tempo → backups to copy one out. Snapshots and the restore picker stay available
          here in Settings.
        </div>
      )}

      {!isDesktop() && (
        <div className="faint settings-hint">
          Folder choice and automatic backups are available in the desktop app.
        </div>
      )}

      <BackupHistory />

      {note && <div className="faint settings-hint">{note}</div>}

      <div className="settings-row" data-setting="data-setup">
        <span className="settings-label">Run setup again</span>
        <div className="settings-control">
          <button className="btn sm subtle" onClick={() => openOnboarding(true)}>
            Open setup
          </button>
        </div>
      </div>
      <div className="faint settings-hint">
        Reopens the welcome flow for appearance and backups. Your work is left untouched.
      </div>
    </div>
  );
}
