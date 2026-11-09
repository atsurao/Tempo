/**
 * The few places where running inside the desktop shell differs from a browser.
 * Everything is looked up lazily so the web build never pulls in Tauri code.
 */

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True when running in the packaged (or `tauri dev`) Tauri shell. */
export function isDesktop(): boolean {
  return inTauri();
}

/** iPhone and iPad, including iPadOS reporting itself as a Mac. */
export function isIOS(): boolean {
  if (!inTauri() || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Save a text file. In the desktop shell WKWebView cancels `download`
 * anchors, so the file is written by the Rust side (into Downloads) and the
 * absolute path comes back. In a browser this falls back to a blob download.
 */
export async function saveTextFile(contents: string, name: string): Promise<string | null> {
  if (inTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string>("save_export", { name, contents });
    // A phone sandbox path means nothing to the reader; the file is in Files →
    // On My iPhone → Tempo, so let the caller name the file instead.
    return isIOS() ? null : path;
  }
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return null;
}

/** Open an http(s) link in the user's real browser instead of the webview. */
export async function openExternal(url: string): Promise<void> {
  if (url.length > 4096) return;
  // The native side checks this too; refusing here keeps a bad link from
  // ever reaching an IPC call.
  if (/[\u0000-\u001f\u007f]/.test(url)) return;
  if (!/^https?:\/\//i.test(url)) return;
  if (inTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** The receipt returned by the automatic backup writer. */
export interface BackupReceipt {
  path: string;
  bytes: number;
  writtenAt: number;
}

/**
 * Ask for the local folder a file-sharing app keeps in sync. Tempo only reads
 * and writes journal files there; the service moves them between devices.
 * Returns the absolute path, or null when cancelled or outside the desktop.
 */
export async function pickSyncFolder(): Promise<string | null> {
  if (!inTauri()) return null;

  // iOS has no path pickers: the Files app hands back a security-scoped
  // bookmark that the scoped-storage plugin persists and can use later.
  if (isIOS()) {
    const { pickFolder, isScopedStorageError } = await import(
      "tauri-plugin-scoped-storage-api"
    );
    try {
      const folder = await pickFolder();
      return folder.id;
    } catch (error) {
      if (isScopedStorageError(error) && error.code === "CANCELLED") return null;
      // iOS can list an iCloud Drive folder that has no local directory yet, and
      // bookmarking it then fails with "doesn't exist". Say what to do instead
      // of repeating the filesystem error.
      if (
        isScopedStorageError(error) &&
        /doesn't exist|couldn't be opened/i.test(error.message)
      ) {
        throw new Error(
          "iOS could not open that folder because it is not stored on this iPhone yet. Open it once in Files so it downloads, then choose it again.",
        );
      }
      throw error;
    }
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    directory: true,
    multiple: false,
    title: "Choose the folder your file-sharing app syncs",
  });
  return typeof picked === "string" ? picked : null;
}

/**
 * Ask for a folder to keep backups in. Returns the absolute path, or null when
 * the picker was cancelled or the browser build has no folder picker at all.
 */
export async function pickBackupFolder(): Promise<string | null> {
  if (!inTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    directory: true,
    multiple: false,
    title: "Choose a folder for Tempo backups",
  });
  return typeof picked === "string" ? picked : null;
}

/** The app-data folder used until the user chooses somewhere else. */
export async function defaultBackupFolder(): Promise<string | null> {
  if (!inTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("default_backup_folder");
}

/**
 * Replace the rolling automatic backup. The native side validates the folder,
 * writes a private (0600) temp file and renames it into place, keeping the
 * previous copy beside it.
 */
export async function writeAutoBackup(
  folder: string,
  contents: string,
): Promise<BackupReceipt> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<BackupReceipt>("write_auto_backup", { folder, contents });
}

/** One timestamped copy of the workspace, kept for the history browser. */
export interface SnapshotReceipt {
  path: string;
  bytes: number;
  writtenAt: number;
}

/** A history row: when it was taken, how big, and what can be searched in it. */
export interface HistoryEntry {
  path: string;
  writtenAt: number;
  bytes: number;
  items: number;
  calendars: number;
  goals: number;
  habits: number;
  schedules: number;
  projects: number;
  titles: string[];
}

/** Write a snapshot beside the rolling backup; the native side prunes old ones. */
export async function writeBackupSnapshot(
  folder: string,
  contents: string,
): Promise<SnapshotReceipt> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<SnapshotReceipt>("write_backup_snapshot", { folder, contents });
}

/** Snapshots from the last two weeks, newest first. Empty in the browser. */
export async function listBackupHistory(folder: string): Promise<HistoryEntry[]> {
  if (!inTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<HistoryEntry[]>("list_backup_history", { folder });
}

/** Read one snapshot back. The native side refuses paths outside the history. */
export async function readBackupSnapshot(folder: string, path: string): Promise<string> {
  if (!inTauri()) throw new Error("Backup history is available in the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("read_backup_snapshot", { folder, path });
}

/** Show a backup file in Finder, Explorer or the desktop file manager. */
export async function revealPath(path: string): Promise<void> {
  if (!inTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_path", { path });
}

/** Ask the webview not to evict the local database under storage pressure. */
export function requestPersistentStorage(): void {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
  void navigator.storage.persist().catch(() => {
    /* best effort — the database still works, it is just evictable */
  });
}
