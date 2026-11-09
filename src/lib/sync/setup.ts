import { db, getSetting, setSetting, syncedTransaction } from "../../db/db";
import { buildBackup } from "../backup";
import { isDesktop, isIOS, saveTextFile } from "../desktop";
import { uid } from "../id";
import { SyncEngine, type SyncRunResult } from "./engine";
import { IosSyncFolder, iosFolderStatus } from "./iosFolder";
import {
  buildSnapshot,
  parseSnapshot,
  parseWorkspace,
  rowKey,
  type MergeEntry,
  type MergeState,
} from "./merge";
import {
  syncFolderStatus,
  TauriSyncFolder,
  type SyncFolderStatus,
} from "./tauriFolder";
import {
  isValidSyncDeviceId,
  SYNCED_TABLES,
  SYNC_FORMAT_VERSION,
  type SyncDeviceRow,
  type SyncFolder,
  type SyncRow,
  type SyncTable,
} from "./types";
import { bypassCurrentSyncTransaction } from "./writeGuard";

const DEVICE_KEY = "sync.device-id";
const INSTALL_KEY = "sync.install-id";
const FOLDER_KEY = "sync.folder-path";
const FOLDER_LABEL_KEY = "sync.folder-label";
const RESET_KEY = "sync.resetPending";

export class SyncSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncSetupError";
  }
}

export interface SyncIdentity {
  deviceId: string;
  installId: string;
  deviceName: string;
}

export interface SafetyBackup {
  name: string;
  path: string | null;
}

/**
 * The folder and identity used by one setup action. Tests supply this directly;
 * the app builds it from the Tauri module and the local settings.
 */
export interface SyncSetup {
  folder: SyncFolder;
  identity: SyncIdentity;
  folderLabel: string | null;
  /** Injected by tests so the safety backup does not need a webview. */
  saveBackup?: (json: string, name: string) => Promise<string | null>;
}

export type BlockedJoinReason =
  | "local-work"
  | "reset"
  | "workspace-mismatch"
  | "missing-workspace";

export type EnableSyncResult =
  | {
      status: "enabled";
      device: SyncDeviceRow;
      run: SyncRunResult;
      backup: SafetyBackup | null;
    }
  | {
      status: "blocked";
      reason: BlockedJoinReason;
      workspaceId: string;
    }
  | { status: "unavailable"; reason: string };

export interface PauseSyncResult {
  paused: boolean;
  pending: number;
  error: string | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultDeviceName(): string {
  if (typeof navigator === "undefined") return "Desktop";
  const ua = navigator.userAgent || "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    return "iPad";
  }
  const platform = navigator.platform || "";
  if (/mac/i.test(platform)) return "Mac";
  if (/win/i.test(platform)) return "Windows";
  if (/linux/i.test(platform)) return "Linux";
  return "This device";
}

async function getOrCreateIdentity(): Promise<SyncIdentity> {
  let deviceId = await getSetting<string>(DEVICE_KEY, "");
  if (!isValidSyncDeviceId(deviceId)) {
    deviceId = uid("mac");
    await setSetting(DEVICE_KEY, deviceId);
  }
  let installId = await getSetting<string>(INSTALL_KEY, "");
  if (!installId) {
    installId = uid("install");
    await setSetting(INSTALL_KEY, installId);
  }
  return { deviceId, installId, deviceName: defaultDeviceName() };
}

/** The local identity, preferring a device row that is already configured. */
async function identityForSetup(): Promise<SyncIdentity> {
  const current = await db.syncDevice.get("local");
  if (current) {
    await setSetting(DEVICE_KEY, current.deviceId);
    await setSetting(INSTALL_KEY, current.installId);
    return {
      deviceId: current.deviceId,
      installId: current.installId,
      deviceName: current.deviceName,
    };
  }
  return getOrCreateIdentity();
}

/** The folder path saved for this device, if one has been chosen. */
export async function readSelectedSyncFolder(): Promise<string | null> {
  const saved = await getSetting<string>(FOLDER_KEY, "");
  if (typeof saved === "string" && saved.trim()) return saved;
  const device = await db.syncDevice.get("local");
  return device?.folderLabel ?? null;
}

/** The human folder name; on iOS the saved handle is opaque. */
export async function readSelectedSyncFolderLabel(): Promise<string | null> {
  const saved = await getSetting<string>(FOLDER_LABEL_KEY, "");
  if (typeof saved === "string" && saved.trim()) return saved;
  const device = await db.syncDevice.get("local");
  return device?.folderLabel ?? null;
}

/**
 * Validate and remember a folder. The native side resolves it to a canonical
 * path; this is the only folder path the sync layer accepts.
 */
export async function setSelectedSyncFolder(path: string): Promise<SyncFolderStatus> {
  const trimmed = path.trim();
  if (!trimmed) throw new SyncSetupError("Choose a folder for sync first.");
  const status = isIOS() ? await iosFolderStatus(trimmed) : await syncFolderStatus(trimmed);
  if (!status.available || !status.root) {
    throw new SyncSetupError(status.reason ?? "That sync folder is unavailable.");
  }
  // iOS stores the security-scoped handle; desktop stores the canonical path.
  await setSetting(FOLDER_KEY, isIOS() ? trimmed : status.root);
  await setSetting(FOLDER_LABEL_KEY, status.root);
  return status;
}

export async function readSyncFolderStatus(): Promise<SyncFolderStatus> {
  if (!isDesktop()) {
    return {
      available: false,
      root: null,
      reason: "Folder sync is available in the desktop app only.",
    };
  }
  const path = await readSelectedSyncFolder();
  if (!path) {
    return {
      available: false,
      root: null,
      reason: "Choose the folder your file-sharing app syncs.",
    };
  }
  try {
    return await syncFolderStatus(path);
  } catch (error) {
    return {
      available: false,
      root: null,
      reason: messageOf(error),
    };
  }
}

export async function setupForSyncFolder(path: string): Promise<SyncSetup> {
  const identity = await identityForSetup();
  if (isIOS()) {
    const label = await readSelectedSyncFolderLabel();
    return {
      identity,
      folder: new IosSyncFolder({
        localDeviceId: identity.deviceId,
        folderId: path,
        label,
      }),
      folderLabel: label,
    };
  }
  return {
    identity,
    folder: new TauriSyncFolder({
      localDeviceId: identity.deviceId,
      rootPath: path,
    }),
    folderLabel: path,
  };
}

export async function defaultSyncSetup(): Promise<SyncSetup> {
  const path = await readSelectedSyncFolder();
  if (!path) throw new SyncSetupError("Choose the folder your file-sharing app syncs.");
  return setupForSyncFolder(path);
}

function newDeviceRow(
  identity: SyncIdentity,
  workspaceId: string,
  folderLabel: string | null,
  enabled: boolean,
): SyncDeviceRow {
  return {
    key: "local",
    deviceId: identity.deviceId,
    installId: identity.installId,
    workspaceId,
    deviceName: identity.deviceName,
    lastSeq: 0,
    lastSnapshotSeq: 0,
    enabled,
    paused: false,
    folderKind: "folder",
    folderLabel,
  };
}

function engineFor(setup: SyncSetup): SyncEngine {
  return new SyncEngine(setup.folder, { platform: isIOS() ? "ios" : "macos" });
}

/**
 * One engine instance only serializes itself. Setup, manual syncs and the
 * background lifecycle all create engines independently, so they share this
 * queue instead of racing each other on the folder and the outbox.
 */
let syncQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = syncQueue.then(work, work);
  syncQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function runSync(setup: SyncSetup, force = true): Promise<SyncRunResult> {
  return serialized(() => engineFor(setup).sync({ force }));
}

function syncedTables() {
  return SYNCED_TABLES.map((table) => db.table(table));
}

async function workspaceRowCount(): Promise<number> {
  let count = 0;
  for (const table of SYNCED_TABLES) count += await db.table(table).count();
  return count;
}

async function hasLocalHistory(): Promise<boolean> {
  if ((await workspaceRowCount()) > 0) return true;
  if ((await db.syncOutbox.count()) > 0) return true;
  return (await db.syncState.count()) > 0;
}

/**
 * Seed a brand-new local journal from the rows already on this device. The
 * initial snapshot carries these revisions, so peers bootstrap from one file
 * instead of replaying a synthetic import one batch at a time.
 */
async function seedLocalState(
  device: SyncDeviceRow,
  at: number,
): Promise<MergeState> {
  return db.transaction(
    "rw",
    [
      ...syncedTables(),
      db.syncDevice,
      db.syncState,
      db.syncOutbox,
      db.syncCursors,
      db.syncConflicts,
    ],
    async () => {
      bypassCurrentSyncTransaction();
      await db.syncState.clear();
      await db.syncOutbox.clear();
      await db.syncCursors.clear();
      await db.syncConflicts.clear();

      const entries = new Map<string, MergeEntry>();
      const states = [];
      for (const table of SYNCED_TABLES) {
        const rows = (await db.table(table).toArray()) as SyncRow[];
        for (const row of rows) {
          const key = rowKey(table, row.id);
          entries.set(key, {
            table,
            id: row.id,
            rev: 1,
            writer: device.deviceId,
            deleted: false,
            at,
            clock: { [device.deviceId]: 1 },
            row,
          });
          states.push({
            key,
            table,
            id: row.id,
            rev: 1,
            writer: device.deviceId,
            deleted: false,
            at,
            clock: { [device.deviceId]: 1 },
            baseRow: row,
          });
        }
      }
      if (states.length > 0) await db.syncState.bulkPut(states);
      await db.syncDevice.put({ ...device, lastSeq: 0, lastSnapshotSeq: 0 });
      return entries as MergeState;
    },
  );
}

async function writeInitialSnapshot(
  setup: SyncSetup,
  device: SyncDeviceRow,
  state: MergeState,
  at: number,
): Promise<void> {
  const existing = await setup.folder.readSnapshot(device.deviceId, 0);
  if (existing !== null) {
    parseSnapshot(existing, device.workspaceId);
    return;
  }
  const snapshot = buildSnapshot(state, {
    workspaceId: device.workspaceId,
    deviceId: device.deviceId,
    seq: 0,
    included: { [device.deviceId]: 0 },
    createdAt: at,
  });
  await setup.folder.writeSnapshot(
    device.deviceId,
    0,
    JSON.stringify(snapshot, null, 2),
  );
}

async function enableDevice(device: SyncDeviceRow): Promise<SyncDeviceRow> {
  const next: SyncDeviceRow = {
    ...device,
    enabled: true,
    paused: false,
  };
  await db.syncDevice.put(next);
  return next;
}

async function discardSyncConfig(): Promise<void> {
  await db.transaction(
    "rw",
    [db.syncDevice, db.syncState, db.syncOutbox, db.syncCursors, db.syncConflicts],
    async () => {
      await db.syncDevice.clear();
      await db.syncState.clear();
      await db.syncOutbox.clear();
      await db.syncCursors.clear();
      await db.syncConflicts.clear();
    },
  );
}

function workspaceText(workspaceId: string, createdBy: string, at: number): string {
  return JSON.stringify(
    {
      format: "tempo-sync-workspace",
      version: SYNC_FORMAT_VERSION,
      workspaceId,
      createdAt: at,
      createdBy,
    },
    null,
    2,
  );
}

async function createNewWorkspace(
  setup: SyncSetup,
  replace: boolean,
): Promise<EnableSyncResult> {
  const at = Date.now();
  const workspaceId = uid("ws");
  const device = newDeviceRow(setup.identity, workspaceId, setup.folderLabel, false);
  await db.syncDevice.put(device);

  let state: MergeState;
  try {
    state = await seedLocalState(device, at);
  } catch (error) {
    await discardSyncConfig();
    throw error;
  }

  try {
    await setup.folder.writeWorkspace(
      workspaceText(workspaceId, setup.identity.deviceId, at),
      replace ? { replace: true } : undefined,
    );
  } catch (error) {
    await discardSyncConfig();
    throw error;
  }

  // From here the workspace exists. Keep the disabled device row so a failed
  // snapshot can be retried instead of making the folder look like a foreign
  // workspace with local work.
  await writeInitialSnapshot(setup, device, state, at);
  const enabled = await enableDevice(device);
  await db.settings.delete(RESET_KEY);
  const run = await runSync(setup);
  return { status: "enabled", device: enabled, run, backup: null };
}

async function resumeIncompleteWorkspace(
  setup: SyncSetup,
  device: SyncDeviceRow,
): Promise<EnableSyncResult> {
  const at = Date.now();
  const existing = await setup.folder.readSnapshot(device.deviceId, 0);
  if (existing === null) {
    const state = await seedLocalState(device, at);
    await writeInitialSnapshot(setup, device, state, at);
  } else {
    parseSnapshot(existing, device.workspaceId);
  }
  const enabled = await enableDevice(device);
  await db.settings.delete(RESET_KEY);
  const run = await runSync(setup);
  return { status: "enabled", device: enabled, run, backup: null };
}

async function replaceLocalRows(workspaceId: string, setup: SyncSetup): Promise<SyncDeviceRow> {
  const device = newDeviceRow(setup.identity, workspaceId, setup.folderLabel, true);
  await db.transaction(
    "rw",
    db.tables,
    async () => {
      bypassCurrentSyncTransaction();
      for (const table of SYNCED_TABLES) await db.table(table).clear();
      await db.syncState.clear();
      await db.syncOutbox.clear();
      await db.syncCursors.clear();
      await db.syncConflicts.clear();
      await db.syncDevice.put(device);
      await db.settings.delete(RESET_KEY);
    },
  );
  return device;
}

async function safetyBackup(setup: SyncSetup): Promise<SafetyBackup | null> {
  if ((await workspaceRowCount()) === 0) return null;
  const { name, json } = await buildBackup();
  const writer = setup.saveBackup ?? saveTextFile;
  const path = await writer(json, name);
  return { name, path };
}

async function readCurrentWorkspace(setup: SyncSetup) {
  const text = await setup.folder.readWorkspace();
  if (text === null) {
    throw new SyncSetupError("The sync folder has no workspace file.");
  }
  return parseWorkspace(text);
}

async function joinWorkspace(
  setup: SyncSetup,
  workspaceId: string,
): Promise<EnableSyncResult> {
  const current = await db.syncDevice.get("local");
  if (current?.enabled && !current.paused) {
    throw new SyncSetupError("Pause sync on this device before joining another workspace.");
  }

  const backup = await safetyBackup(setup);
  const device = await replaceLocalRows(workspaceId, setup);
  const run = await runSync(setup);
  return { status: "enabled", device, run, backup };
}

/**
 * Turn sync on. An empty folder gets a new workspace; an empty local database
 * joins the workspace already there; anything else stops for an explicit
 * join/start-new choice.
 */
export async function enableSync(setup?: SyncSetup): Promise<EnableSyncResult> {
  const status = setup ? null : await readSyncFolderStatus();
  if (!setup && !status?.available) {
    return {
      status: "unavailable",
      reason: status?.reason ?? "The sync folder is unavailable.",
    };
  }
  const activeSetup = setup ?? (await defaultSyncSetup());
  const current = await db.syncDevice.get("local");
  const text = await activeSetup.folder.readWorkspace();

  if (text === null) {
    if (current) {
      return { status: "blocked", reason: "missing-workspace", workspaceId: current.workspaceId };
    }
    return createNewWorkspace(activeSetup, false);
  }

  const workspace = parseWorkspace(text);

  if (current && current.workspaceId === workspace.workspaceId) {
    if (!current.enabled) return resumeIncompleteWorkspace(activeSetup, current);
    if (current.paused) {
      const enabled = await enableDevice(current);
      await db.settings.delete(RESET_KEY);
      const run = await runSync(activeSetup);
      return { status: "enabled", device: enabled, run, backup: null };
    }
    const run = await runSync(activeSetup);
    return { status: "enabled", device: current, run, backup: null };
  }

  if (current) {
    return { status: "blocked", reason: "workspace-mismatch", workspaceId: workspace.workspaceId };
  }

  if (await getSetting<boolean>(RESET_KEY, false)) {
    return { status: "blocked", reason: "reset", workspaceId: workspace.workspaceId };
  }

  if (await hasLocalHistory()) {
    return { status: "blocked", reason: "local-work", workspaceId: workspace.workspaceId };
  }

  return joinWorkspace(activeSetup, workspace.workspaceId);
}

/**
 * Blocked join choice 1: keep the folder's workspace and replace this device's
 * work. A JSON backup is written before anything is cleared.
 */
export async function joinExistingWorkspace(
  setup?: SyncSetup,
): Promise<EnableSyncResult> {
  const status = setup ? null : await readSyncFolderStatus();
  if (!setup && !status?.available) {
    return {
      status: "unavailable",
      reason: status?.reason ?? "The sync folder is unavailable.",
    };
  }
  const activeSetup = setup ?? (await defaultSyncSetup());
  const workspace = await readCurrentWorkspace(activeSetup);
  return joinWorkspace(activeSetup, workspace.workspaceId);
}

/**
 * Blocked join choice 2: keep this device's work and start a fresh journal. The
 * native replace path archives the previous workspace's device folders.
 */
export async function startNewWorkspace(
  setup?: SyncSetup,
): Promise<EnableSyncResult> {
  const status = setup ? null : await readSyncFolderStatus();
  if (!setup && !status?.available) {
    return {
      status: "unavailable",
      reason: status?.reason ?? "The sync folder is unavailable.",
    };
  }
  const activeSetup = setup ?? (await defaultSyncSetup());
  const current = await db.syncDevice.get("local");
  if (current?.enabled && !current.paused) {
    throw new SyncSetupError("Pause sync on this device before starting a new workspace.");
  }
  return createNewWorkspace(activeSetup, true);
}

/** Stop folder access. Local edits keep entering the journal for a later resume. */
export async function pauseSync(setup?: SyncSetup): Promise<PauseSyncResult> {
  const activeSetup = setup ?? (await defaultSyncSetup());
  return serialized(async () => {
    const device = await db.syncDevice.get("local");
    if (!device) return { paused: false, pending: 0, error: null };

    const engine = engineFor(activeSetup);
    let pending = await db.syncOutbox.count();
    let error: string | null = null;
    if (device.enabled && !device.paused) {
      try {
        const flushed = await engine.flush({ force: true });
        pending = flushed.pending;
        error = flushed.error;
      } catch (failure) {
        error = messageOf(failure);
      }
    }

    await db.syncDevice.update("local", { paused: true });
    await engine.refreshMeta().catch(() => undefined);
    return { paused: true, pending, error };
  });
}

export interface SyncNowOptions {
  /** Manual passes retry through backoff; background passes respect it. */
  force?: boolean;
}

/** Run a pass now. Manual callers force past a pending retry delay. */
export async function syncNow(
  setup?: SyncSetup,
  options: SyncNowOptions = {},
): Promise<SyncRunResult> {
  const activeSetup = setup ?? (await defaultSyncSetup());
  const device = await db.syncDevice.get("local");
  if (!device?.enabled) throw new SyncSetupError("Sync is not enabled on this device.");
  if (device.paused) throw new SyncSetupError("Turn sync back on before syncing.");
  return runSync(activeSetup, options.force ?? true);
}

/** Put a conflicted local copy back, which becomes a new winning revision. */
export async function restoreConflict(id: number): Promise<void> {
  const conflict = await db.syncConflicts.get(id);
  if (!conflict || !conflict.lostRow) {
    throw new SyncSetupError("That conflict no longer has a local copy to restore.");
  }
  const table: SyncTable = conflict.table;
  const row = { ...conflict.lostRow, id: conflict.rowId } as SyncRow;
  await syncedTransaction([db.table(table)], async (tx) => {
    await tx.put(table, row);
  });
  await db.syncConflicts.delete(id);
}

export async function dismissConflict(id: number): Promise<void> {
  await db.syncConflicts.delete(id);
}
