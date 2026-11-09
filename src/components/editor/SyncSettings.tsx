import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  CloudOff,
  FolderOpen,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { db } from "../../db/db";
import { pickSyncFolder } from "../../lib/desktop";
import { Switch } from "../ui/Switch";
import { TabStrip } from "../ui/TabStrip";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { SyncRunResult } from "../../lib/sync/engine";
import {
  dismissConflict,
  enableSync,
  joinExistingWorkspace,
  pauseSync,
  readSelectedSyncFolder,
  readSyncFolderStatus,
  restoreConflict,
  setSelectedSyncFolder,
  startNewWorkspace,
  syncNow,
  type BlockedJoinReason,
} from "../../lib/sync/setup";
import type { SyncConflictRow, SyncTable } from "../../lib/sync/types";
import type { SyncFolderStatus } from "../../lib/sync/tauriFolder";

const TABLE_LABELS: Record<SyncTable, string> = {
  items: "Item",
  projects: "Project",
  tags: "Tag",
  focusSessions: "Focus session",
  goals: "Goal",
  schedules: "Schedule",
  scheduleItems: "Schedule block",
  scheduleBreaks: "Schedule break",
  scheduleExceptions: "Schedule exception",
  workProjects: "Work project",
  members: "Member",
  taskDependencies: "Dependency",
  habits: "Habit",
  habitCheckins: "Habit check-in",
};

interface BlockedState {
  reason: BlockedJoinReason;
  workspaceId: string;
}

type ConfirmChoice = "join" | "start" | null;
type NoticeTone = "success" | "error";
interface Notice {
  tone: NoticeTone;
  text: string;
}
interface LastRun {
  run: SyncRunResult;
  at: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function relative(at: number): string {
  return formatDistanceToNowStrict(at, { addSuffix: true });
}

function conflictTitle(conflict: SyncConflictRow): string {
  const row = conflict.lostRow;
  const title = row?.title ?? row?.name ?? row?.id;
  return typeof title === "string" && title.trim() ? title : "This row";
}

function runSummary(run: SyncRunResult): string {
  const parts: string[] = [];
  if (run.flush.written > 0) {
    parts.push(`${run.flush.written} batch${run.flush.written === 1 ? "" : "es"} written`);
  }
  const received = run.pull.appliedBatches + run.pull.appliedSnapshots;
  if (received > 0) {
    parts.push(`${received} change${received === 1 ? "" : "s"} received`);
  }
  if (run.pull.merged > 0) {
    parts.push(`${run.pull.merged} edit${run.pull.merged === 1 ? "" : "s"} combined`);
  }
  if (run.pull.conflicts > 0) {
    parts.push(`${run.pull.conflicts} conflict${run.pull.conflicts === 1 ? "" : "s"}`);
  }
  if (run.pull.blocked.length > 0) {
    parts.push("some changes need a choice");
  }
  if (run.flush.error || run.pull.errors.length > 0) {
    parts.push(run.flush.error ?? run.pull.errors[0]?.message ?? "a sync error");
  }
  return parts.length ? parts.join(" · ") : "Everything is up to date.";
}

function blockedCopy(reason: BlockedJoinReason): { title: string; body: string } {
  switch (reason) {
    case "reset":
      return {
        title: "This device was reset",
        body:
          "The sync folder still holds the workspace from before the reset. Start a new workspace to make this device the first device in it, or join the old one to bring its work back.",
      };
    case "local-work":
      return {
        title: "This sync folder already has a workspace",
        body:
          "This device has its own work, so joining would replace it. Tempo can save a JSON backup first, or keep this device's work and start a new workspace in the folder.",
      };
    case "missing-workspace":
      return {
        title: "The sync folder has no workspace file",
        body:
          "Tempo cannot tell which workspace this folder belonged to. Start a new one with this device's work; the old device folders will be archived.",
      };
    case "workspace-mismatch":
      return {
        title: "This device last synced a different workspace",
        body:
          "The sync folder now belongs to another workspace. Join that one, or keep this device's work and start a new workspace here.",
      };
  }
}

/**
 * Settings → Sync. Setup is deliberately a small state machine: the toggle
 * enables or pauses, while a join that would replace local work stops at an
 * explicit choice instead of guessing.
 */
export function SyncSettings({ visible = true }: { visible?: boolean }) {
  const device = useLiveQuery(() => db.syncDevice.get("local"), []) ?? null;
  const pending = useLiveQuery(() => db.syncOutbox.count(), []) ?? 0;
  const peers = useLiveQuery(() => db.syncCursors.count(), []) ?? 0;
  const conflicts =
    useLiveQuery(
      () => db.syncConflicts.orderBy("at").reverse().limit(6).toArray(),
      [],
    ) ?? [];
  const conflictCount = useLiveQuery(() => db.syncConflicts.count(), []) ?? 0;

  const [folder, setFolder] = useState<SyncFolderStatus | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [checkingFolder, setCheckingFolder] = useState(true);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<BlockedState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmChoice>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [conflictBusy, setConflictBusy] = useState<number | null>(null);
  const mobile = useIsMobile();
  const [tab, setTab] = useState<"status" | "folder" | "conflicts">("status");

  const active = !!device?.enabled && !device.paused;
  const configured = !!device?.enabled;
  const folderReady = !!folder?.available;

  const checkFolder = async () => {
    setCheckingFolder(true);
    try {
      const [nextFolder, nextPath] = await Promise.all([
        readSyncFolderStatus(),
        readSelectedSyncFolder(),
      ]);
      setFolder(nextFolder);
      setFolderPath(nextFolder.root ?? nextPath);
    } finally {
      setCheckingFolder(false);
    }
  };

  useEffect(() => {
    if (visible) void checkFolder();
  }, [visible]);

  const showRun = (run: SyncRunResult) => {
    setLastRun({ run, at: Date.now() });
    const failed =
      run.flush.status === "error" ||
      run.flush.status === "backoff" ||
      run.pull.status === "error" ||
      run.pull.status === "blocked";
    setNotice({ tone: failed ? "error" : "success", text: runSummary(run) });
  };

  const chooseFolder = async () => {
    if (active) {
      setNotice({ tone: "error", text: "Pause sync before changing the folder." });
      return;
    }
    setPicking(true);
    setNotice(null);
    setBlocked(null);
    setConfirm(null);
    try {
      const picked = await pickSyncFolder();
      if (!picked) {
        setNotice({
          tone: "error",
          text: "The picker closed without returning a folder, so nothing changed. Open the folder in the picker, then tap Open in its top corner.",
        });
        return;
      }
      const status = await setSelectedSyncFolder(picked);
      setFolder(status);
      setFolderPath(status.root ?? picked);
      const name = status.root ?? "the selected folder";
      setNotice({
        tone: "success",
        text: configured
          ? `Folder changed to “${name}”. Turn sync on to join or start a workspace there.`
          : `Sync folder set to “${name}”. Turn sync on to start using it.`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error) });
    } finally {
      setPicking(false);
    }
  };

  const enable = async () => {
    setBusy(true);
    setTab("status");
    setNotice(null);
    setBlocked(null);
    setConfirm(null);
    try {
      const result = await enableSync();
      if (result.status === "unavailable") {
        setNotice({ tone: "error", text: result.reason });
      } else if (result.status === "blocked") {
        setBlocked({ reason: result.reason, workspaceId: result.workspaceId });
      } else {
        showRun(result.run);
        if (result.backup) {
          setNotice({
            tone: "success",
            text: `Joined the workspace in this folder. Saved a backup ${
              result.backup.path ? `to ${result.backup.path}` : `as ${result.backup.name}`
            }.`,
          });
        }
      }
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  const pause = async () => {
    setBusy(true);
    setTab("status");
    setNotice(null);
    try {
      const result = await pauseSync();
      if (!result.paused) {
        setNotice({ tone: "error", text: "Sync is not enabled on this device." });
      } else if (result.error) {
        setNotice({
          tone: "error",
          text: `Sync is paused, but ${result.pending} batch${
            result.pending === 1 ? "" : "es"
          } still need writing to the folder. ${result.error}`,
        });
      } else if (result.pending > 0) {
        setNotice({
          tone: "success",
          text: `Sync is paused. ${result.pending} batch${
            result.pending === 1 ? "" : "es"
          } will be written when you turn it back on.`,
        });
      } else {
        setNotice({
          tone: "success",
          text: "Sync is paused. New edits stay in the local journal until you turn it back on.",
        });
      }
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  const manualSync = async () => {
    setBusy(true);
    setTab("status");
    setNotice(null);
    try {
      showRun(await syncNow());
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await joinExistingWorkspace();
      if (result.status === "unavailable") {
        setNotice({ tone: "error", text: result.reason });
        return;
      }
      if (result.status === "blocked") {
        setBlocked({ reason: result.reason, workspaceId: result.workspaceId });
        return;
      }
      setBlocked(null);
      setConfirm(null);
      showRun(result.run);
      setNotice({
        tone: "success",
        text: result.backup
          ? `Joined the workspace in this folder. This device's previous work is in ${
              result.backup.path ?? result.backup.name
            }.`
          : "Joined the workspace in this folder.",
      });
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  const startNew = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await startNewWorkspace();
      if (result.status === "unavailable") {
        setNotice({ tone: "error", text: result.reason });
        return;
      }
      if (result.status === "blocked") {
        setBlocked({ reason: result.reason, workspaceId: result.workspaceId });
        return;
      }
      setBlocked(null);
      setConfirm(null);
      showRun(result.run);
      setNotice({
        tone: "success",
        text:
          "New workspace started. Other devices will stop syncing until they join it; the old sync files are archived in the folder.",
      });
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  const keepConflict = async (conflict: SyncConflictRow) => {
    if (conflict.id == null) return;
    setConflictBusy(conflict.id);
    setNotice(null);
    try {
      await restoreConflict(conflict.id);
      setNotice({
        tone: "success",
        text: "The local copy is back. It is written to the folder on the next sync.",
      });
      if (active && folderReady) {
        try {
          showRun(await syncNow());
        } catch {
          /* The copy is already restored; a retry can wait for the next pass. */
        }
      }
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error) });
    } finally {
      setConflictBusy(null);
    }
  };

  const dismiss = async (conflict: SyncConflictRow) => {
    if (conflict.id == null) return;
    await dismissConflict(conflict.id);
  };

  const state = checkingFolder
    ? "checking"
    : !folderReady
      ? "unavailable"
      : !configured
        ? "off"
        : device?.paused
          ? "paused"
          : busy
            ? "busy"
            : pending > 0
              ? "pending"
              : "on";
  const stateLabel =
    state === "checking"
      ? "Checking folder…"
      : state === "unavailable"
        ? "Unavailable"
        : state === "off"
          ? "Off"
          : state === "paused"
            ? "Paused"
            : state === "busy"
              ? "Syncing…"
              : state === "pending"
                ? `${pending} batch${pending === 1 ? "" : "es"} queued`
                : "On";

  const blockedTitle = blocked ? blockedCopy(blocked.reason) : null;
  const startRecommended =
    blocked?.reason === "reset" || blocked?.reason === "missing-workspace";

  return (
    <div className="sync-settings">
      <div className="sync-card" data-setting="sync-enable">
        <div className="sync-head">
          <div className="sync-head-text">
            <span className="sync-title">
              {active ? <FolderOpen size={14} /> : <CloudOff size={14} />}
              Folder sync
            </span>
            <span className="sync-state" data-state={state}>
              {stateLabel}
            </span>
          </div>
          <Switch
            checked={active}
            label="Sync this device through a shared folder"
            disabled={busy || checkingFolder || (!active && !folderReady)}
            onChange={(on) => {
              if (on) void enable();
              else void pause();
            }}
          />
        </div>

        {mobile && (
          <TabStrip
            value={tab}
            onChange={setTab}
            ariaLabel="Sync sections"
            tabs={[
              { id: "status", label: "Status" },
              { id: "folder", label: "Folder" },
              { id: "conflicts", label: "Conflicts", badge: conflictCount },
            ]}
          />
        )}

        {notice && (
          <div className="sync-notice" data-tone={notice.tone}>
            {notice.text}
          </div>
        )}

        <div
          className="sync-panel"
          data-mobile-panel="status"
          hidden={mobile && tab !== "status"}
        >
        <div className="faint sync-hint">
          {active
            ? "Tempo writes each change as a journal file into the folder you chose. Your file-sharing app moves those files between devices."
            : "Choose a folder that iCloud Drive, Dropbox, Google Drive, Syncthing or another file-sharing app keeps in sync. Tempo only reads and writes files there."}
        </div>

        {configured && device?.paused && (
          <div className="sync-paused-note">
            Sync is off. Edits still enter the local journal, so turning it back on writes
            everything that changed while it was paused.
          </div>
        )}

        <div className="sync-facts" data-setting="sync-status">
          <div className="sync-fact">
            <span className="sync-fact-value tabular">{pending}</span>
            <span className="sync-fact-label">Pending batches</span>
          </div>
          <div className="sync-fact">
            <span className="sync-fact-value tabular">{peers}</span>
            <span className="sync-fact-label">Devices seen</span>
          </div>
          <div className="sync-fact">
            <span className="sync-fact-value tabular">{conflictCount}</span>
            <span className="sync-fact-label">Conflicts</span>
          </div>
        </div>

        <div className="sync-actions">
          <button
            className="btn sm primary"
            disabled={!active || !folderReady || busy}
            onClick={() => void manualSync()}
          >
            <RefreshCw size={11} className={busy ? "sync-spin" : undefined} />
            {busy ? "Syncing…" : "Sync now"}
          </button>
          {lastRun && (
            <span className="sync-last">
              Last pass {relative(lastRun.at)}
            </span>
          )}
        </div>

        {mobile && (
          <div className="sync-folder-line">
            <FolderOpen size={11} />
            <span>{folderPath ?? folder?.root ?? "No folder chosen"}</span>
            {!active && (
              <button
                className="btn sm subtle"
                onClick={() => {
                  setTab("folder");
                  void chooseFolder();
                }}
              >
                {folderPath ? "Change" : "Choose"}
              </button>
            )}
          </div>
        )}
        </div>

        <div
          className="sync-panel"
          data-mobile-panel="folder"
          hidden={mobile && tab !== "folder"}
        >
          <div className="sync-container" data-available={folderReady}>
            <FolderOpen size={14} className="sync-container-icon" />
            <div className="sync-container-body">
              <span className="sync-container-label">Sync folder</span>
              <span className="sync-container-path">
                {folderPath ?? folder?.root ?? "No folder chosen"}
              </span>
              {!folderReady && !checkingFolder && (
                <span className="sync-container-reason">
                  {folder?.reason ?? "Choose the folder your file-sharing app syncs."}
                </span>
              )}
              {!active && (
                <button
                  className="btn sm subtle sync-container-action"
                  disabled={busy || picking}
                  onClick={() => void chooseFolder()}
                >
                  <FolderOpen size={11} />
                  {picking ? "Choosing…" : folderPath ? "Change folder…" : "Choose folder…"}
                </button>
              )}
              {active && (
                <span className="faint sync-container-note">
                  Pause sync to change folders.
                </span>
              )}
            </div>
            <button
              className="icon-btn"
              title="Check folder again"
              aria-label="Check folder again"
              disabled={busy || checkingFolder}
              onClick={() => void checkFolder()}
            >
              <RefreshCw size={12} className={checkingFolder ? "sync-spin" : undefined} />
            </button>
          </div>

          <div className="faint sync-hint">
            Choose the folder that iCloud Drive, Dropbox, Google Drive, Syncthing or another
            file-sharing app keeps in sync. Tempo never connects to the service itself; it
            only reads and writes journal files in this folder.
          </div>
        </div>
      </div>

      {blocked && blockedTitle && (
        <div
          className="sync-panel"
          data-mobile-panel="status"
          hidden={mobile && tab !== "status"}
        >
        <div className="sync-blocked" data-setting="sync-blocked">
          <div className="sync-blocked-head">
            <AlertTriangle size={14} />
            {blockedTitle.title}
          </div>
          <p>{blockedTitle.body}</p>

          {confirm === null ? (
            <div className="sync-blocked-actions">
              {blocked.reason !== "missing-workspace" && (
                <button
                  className={`btn sm ${startRecommended ? "subtle" : "primary"}`}
                  disabled={busy}
                  onClick={() => setConfirm("join")}
                >
                  Join this workspace
                </button>
              )}
              <button
                className={`btn sm ${startRecommended ? "primary" : "subtle"}`}
                disabled={busy}
                onClick={() => setConfirm("start")}
              >
                Start a new workspace
              </button>
              <button
                className="btn sm subtle"
                disabled={busy}
                onClick={() => {
                  setBlocked(null);
                  setConfirm(null);
                }}
              >
                Cancel
              </button>
            </div>
          ) : confirm === "join" ? (
            <div className="sync-confirm">
              <p>
                Tempo will write a JSON backup of this device to Downloads first, then replace
                its workspace with the copy in this folder. This cannot be undone from
                inside Tempo.
              </p>
              <div className="sync-blocked-actions">
                <button
                  className="btn sm primary"
                  disabled={busy}
                  onClick={() => void join()}
                >
                  Join and replace this device
                </button>
                <button
                  className="btn sm subtle"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="sync-confirm">
              <p>
                This keeps the work on this device and writes a fresh workspace to the sync
                folder. The old sync files are archived in the folder, and other devices
                will stop syncing until they join the new workspace.
              </p>
              <div className="sync-blocked-actions">
                <button
                  className="btn sm primary"
                  disabled={busy}
                  onClick={() => void startNew()}
                >
                  Start new workspace
                </button>
                <button
                  className="btn sm subtle"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      )}

      <div
        className="sync-section"
        data-setting="sync-conflicts"
        data-mobile-panel="conflicts"
        hidden={mobile && tab !== "conflicts"}
      >
        <div className="sync-section-head">
          <ShieldAlert size={13} />
          <span>Conflicts</span>
          <span className="spacer" />
          <span className="chip">{conflictCount}</span>
        </div>
        {conflicts.length === 0 ? (
          <div className="sync-empty faint">
            No conflicts. When two devices edit the same row, the newer revision wins and
            the older copy appears here for a week.
          </div>
        ) : (
          <div className="sync-conflict-list">
            {conflicts.map((conflict) => (
              <div className="sync-conflict" key={conflict.id ?? `${conflict.table}:${conflict.rowId}`}>
                <div className="sync-conflict-main">
                  <span className="sync-conflict-title">{conflictTitle(conflict)}</span>
                  <span className="sync-conflict-meta">
                    {TABLE_LABELS[conflict.table]} ·{" "}
                    {conflict.winner === "remote"
                      ? `the other device's revision ${conflict.remoteRev} won`
                      : `this device's revision ${conflict.localRev} won`}{" "}
                    · {relative(conflict.at)}
                  </span>
                </div>
                <div className="sync-conflict-actions">
                  {conflict.lostRow && (
                    <button
                      className="btn sm subtle"
                      disabled={busy || conflictBusy === conflict.id}
                      onClick={() => void keepConflict(conflict)}
                    >
                      Keep this device's copy
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    title="Dismiss conflict"
                    aria-label="Dismiss conflict"
                    disabled={busy}
                    onClick={() => void dismiss(conflict)}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="faint settings-note" hidden={mobile && tab !== "status"}>
        Tempo reads and writes per-device journal files in the folder you choose. It never
        connects to iCloud, Dropbox, Google Drive or another sync service; the app that
        owns the folder moves the files between devices.
      </div>
    </div>
  );
}
