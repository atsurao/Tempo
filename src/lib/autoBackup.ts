import { db, exportAll } from "../db/db";
import { readBackupConfig, writeBackupConfig, type BackupConfig } from "./appSettings";
import {
  defaultBackupFolder,
  isDesktop,
  writeAutoBackup,
  writeBackupSnapshot,
  type SnapshotReceipt,
} from "./desktop";

/**
 * Automatic local backups.
 *
 * Every write to the workspace tables is observed through a Dexie middleware,
 * and the actual file is written once the edits stop — a burst of checkboxes,
 * an import, or a whole editor session becomes one backup, not one per row.
 * Preferences are exempt: saving the "last backup" stamp must not ask for
 * another backup.
 */

/** How long the workspace has to stay quiet before a backup is written. */
const IDLE_MS = 8_000;

/**
 * How often a timestamped snapshot joins the searchable history. The rolling
 * backup already covers the last save; hourly is enough detail for "two weeks
 * ago" without filling the folder, and the native side caps both count and age.
 */
const HISTORY_INTERVAL_MS = 60 * 60 * 1000;

/** Journal bookkeeping is not workspace content and must not trigger a backup. */
const SYNC_TABLES = new Set([
  "syncDevice",
  "syncState",
  "syncOutbox",
  "syncCursors",
  "syncConflicts",
]);

export type AutoBackupStatus = "idle" | "pending" | "saving" | "saved" | "error" | "off";

export interface AutoBackupState {
  status: AutoBackupStatus;
  lastAt: number | null;
  path: string | null;
  error: string | null;
}

let state: AutoBackupState = { status: "idle", lastAt: null, path: null, error: null };
const listeners = new Set<(state: AutoBackupState) => void>();
let installed = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let saving = false;
let fingerprint: string | null = null;

function emit(patch: Partial<AutoBackupState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function subscribeAutoBackup(listener: (state: AutoBackupState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function autoBackupState(): AutoBackupState {
  return state;
}

/**
 * Watch the database once per page. The middleware sits below the typed
 * tables, so `add`, `put`, `bulkAdd`, `update` and `delete` all pass through
 * `mutate` and nothing can be edited without being noticed.
 */
export function installAutoBackup(): void {
  if (installed) return;
  installed = true;

  db.use({
    stack: "dbcore",
    name: "tempo-auto-backup",
    create: (down) => ({
      ...down,
      table: (name) => {
        const table = down.table(name);
        if (name === "settings" || SYNC_TABLES.has(name)) return table;
        return {
          ...table,
          mutate: (request) => {
            const result = table.mutate(request);
            scheduleAutoBackup();
            return result;
          },
        };
      },
    }),
  });

  // A hidden window is usually the last moment there is to write: flush what
  // is pending instead of waiting out the idle timer that may never fire.
  if (typeof window !== "undefined") {
    const flush = () => {
      if (dirty) void flushAutoBackup();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
}

/** Mark the workspace dirty and write once the edits have settled. */
export function scheduleAutoBackup(delay = IDLE_MS): void {
  dirty = true;
  if (timer) clearTimeout(timer);
  if (state.status !== "saving") emit({ status: "pending" });
  timer = setTimeout(() => {
    timer = null;
    void flushAutoBackup();
  }, delay);
}

/**
 * Write the current workspace to the chosen folder. `manual` forces a file
 * even when nothing changed since the last backup (the Settings button).
 */
export async function flushAutoBackup(reason: "idle" | "manual" = "idle"): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (saving) {
    if (reason === "manual") dirty = true;
    return;
  }
  if (!dirty && reason !== "manual") return;

  let config: BackupConfig;
  try {
    config = await readBackupConfig();
  } catch {
    return;
  }

  if (!config.enabled || !config.folder) {
    dirty = false;
    emit({ status: "off", error: null });
    return;
  }
  if (!isDesktop()) {
    dirty = false;
    emit({ status: "off", error: "Automatic backups run in the desktop app." });
    return;
  }

  dirty = false;
  saving = true;
  emit({ status: "saving", error: null });

  try {
    const json = await exportAll();
    const print = fingerprintOf(json);
    if (reason === "idle" && print === fingerprint) {
      emit({ status: "saved", lastAt: config.lastAt, path: config.lastPath, error: null });
      return;
    }
    const receipt = await writeAutoBackup(config.folder, json);
    fingerprint = print;

    // History is a second, timestamped copy. It is deliberately best effort:
    // a full history folder must never take the rolling backup down with it.
    let snapshotAt = config.lastSnapshotAt;
    if (
      snapshotAt == null ||
      receipt.writtenAt - snapshotAt >= HISTORY_INTERVAL_MS
    ) {
      try {
        const snapshot = await writeBackupSnapshot(config.folder, json);
        snapshotAt = snapshot.writtenAt;
      } catch {
        /* the autosave file is already safely written */
      }
    }

    await writeBackupConfig({
      lastAt: receipt.writtenAt,
      lastPath: receipt.path,
      ...(snapshotAt !== config.lastSnapshotAt ? { lastSnapshotAt: snapshotAt } : {}),
    });
    emit({
      status: "saved",
      lastAt: receipt.writtenAt,
      path: receipt.path,
      error: null,
    });
  } catch (error) {
    // Keep it dirty: the next edit retries, and a full disk is not permanent.
    dirty = true;
    emit({ status: "error", error: describe(error) });
  } finally {
    saving = false;
  }
}

/**
 * Take a snapshot right now, regardless of the hourly throttle. Restoring a
 * history entry calls this first, so the workspace being replaced is itself
 * recoverable; the Settings history can also use it for a deliberate save.
 */
export async function snapshotNow(): Promise<SnapshotReceipt | null> {
  const config = await readBackupConfig();
  // Deliberately not gated on `enabled`: a manual snapshot, and the safety copy
  // taken before a restore, should still be possible with automation off.
  if (!config.folder || !isDesktop()) return null;
  const json = await exportAll();
  const receipt = await writeBackupSnapshot(config.folder, json);
  await writeBackupConfig({ lastSnapshotAt: receipt.writtenAt });
  return receipt;
}

/**
 * On launch, show the last backup time and, if this install has never written
 * one, take a first snapshot shortly after the window settles.
 */
export async function primeAutoBackup(): Promise<void> {
  try {
    let config = await readBackupConfig();
    // An install that predates automatic backups adopts the app's own folder
    // on first launch, so protection does not depend on finding a setting.
    if (config.enabled && !config.folder) {
      const fallback = await defaultBackupFolder();
      if (fallback) config = await writeBackupConfig({ folder: fallback });
    }
    if (!config.enabled || !config.folder) {
      emit({ status: "off", lastAt: config.lastAt, path: config.lastPath });
      return;
    }
    emit({ status: "idle", lastAt: config.lastAt, path: config.lastPath });
    if (!config.lastAt && isDesktop()) scheduleAutoBackup(4_000);
  } catch {
    /* a settings read failure leaves backups idle, not broken */
  }
}

/** Hash the workspace without its export stamp, which changes every read. */
function fingerprintOf(json: string): string {
  let text = json;
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    delete data.exportedAt;
    text = JSON.stringify(data);
  } catch {
    /* fall through to hashing the raw text */
  }
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return `${text.length}:${hash >>> 0}`;
}

function describe(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error.trim().slice(0, 240);
  if (error instanceof Error && error.message) return error.message.slice(0, 240);
  return "The backup could not be written.";
}
