import {
  exists,
  getFolderInfo,
  mkdir,
  readDir,
  readTextFile,
  removeFile,
  rename,
  stat,
  writeTextFile,
} from "tauri-plugin-scoped-storage-api";
import {
  isValidSyncDeviceId,
  MAX_SYNC_FILE_BYTES,
  type SyncFolder,
} from "./types";
import type { SyncFolderStatus } from "./tauriFolder";

/**
 * The same journal layout the desktop writes, opened through an iOS
 * security-scoped folder picked in the Files app. The native plugin keeps the
 * bookmark across launches; this class only builds validated relative paths.
 *
 *   workspace.json
 *   devices/<device-id>/meta.json
 *   devices/<device-id>/ops/00000001.json
 *   devices/<device-id>/snapshots/00000000.json
 */

const WORKSPACE = "workspace.json";
const DEVICES = "devices";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codeOf(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function isMissing(error: unknown): boolean {
  const code = codeOf(error);
  if (code === "NOT_FOUND" || code === "FOLDER_NOT_FOUND") return true;
  // iOS reports a directory that has no entries yet as a read failure rather
  // than a missing path; an absent ops/ folder is an empty journal, not an error.
  return /no such file|doesn't exist|could not be found/i.test(messageOf(error));
}

function fileName(seq: number): string {
  return `${String(seq).padStart(8, "0")}.json`;
}

function parseSeq(name: string, min: number): number | null {
  const match = /^(\d{8})\.json$/.exec(name);
  if (!match) return null;
  const seq = Number(match[1]);
  if (!Number.isSafeInteger(seq) || seq < min) return null;
  return seq;
}

function parentOf(path: string): string | null {
  const at = path.lastIndexOf("/");
  return at < 0 ? null : path.slice(0, at);
}

function assertSeq(seq: number, min: number): void {
  if (!Number.isSafeInteger(seq) || seq < min) {
    throw new Error("Invalid sync sequence.");
  }
}

async function ensureDir(folderId: string, path: string | null): Promise<void> {
  if (!path) return;
  try {
    await mkdir(folderId, path, true);
  } catch (error) {
    if (codeOf(error) === "ALREADY_EXISTS") return;
    throw error;
  }
}

async function listDirSafe(folderId: string, path: string) {
  try {
    return await readDir(folderId, path);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

export interface IosSyncFolderOptions {
  localDeviceId: string;
  /** The persistent folder handle returned by the Files picker. */
  folderId: string;
  /** A human name for Settings. */
  label?: string | null;
}

export class IosSyncFolder implements SyncFolder {
  readonly localDeviceId: string;
  readonly folderId: string;
  readonly label: string | null;

  constructor(options: IosSyncFolderOptions) {
    if (!isValidSyncDeviceId(options.localDeviceId)) {
      throw new Error("Invalid local sync device id.");
    }
    if (!options.folderId.trim()) {
      throw new Error("Choose a folder for sync first.");
    }
    this.localDeviceId = options.localDeviceId;
    this.folderId = options.folderId;
    this.label = options.label ?? null;
  }

  async status(): Promise<SyncFolderStatus> {
    try {
      const info = await getFolderInfo(this.folderId);
      return {
        available: true,
        root: info.name || this.label || "Shared folder",
        reason: null,
      };
    } catch (error) {
      return {
        available: false,
        root: null,
        reason:
          codeOf(error) === "FOLDER_NOT_FOUND"
            ? "Tempo lost access to this folder. Choose it again in the Files app."
            : messageOf(error),
      };
    }
  }

  async readWorkspace(): Promise<string | null> {
    return await this.read(WORKSPACE);
  }

  async writeWorkspace(text: string, options?: { replace?: boolean }): Promise<void> {
    const existing = await this.read(WORKSPACE);
    if (existing !== null && !options?.replace) {
      throw new Error("The sync folder already has a workspace.");
    }
    if (options?.replace) await this.archiveDevices();
    if (existing !== null) await removeFile(this.folderId, WORKSPACE);
    await this.writeCreate(WORKSPACE, text);
  }

  async listDevices(): Promise<string[]> {
    const entries = await listDirSafe(this.folderId, DEVICES);
    return entries
      .filter((entry) => entry.isDir && isValidSyncDeviceId(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  async readMeta(deviceId: string): Promise<string | null> {
    return await this.read(this.metaPath(deviceId));
  }

  async writeMeta(deviceId: string, text: string): Promise<void> {
    this.checkDevice(deviceId);
    const path = this.metaPath(deviceId);
    await ensureDir(this.folderId, parentOf(path));
    await this.writeReplace(path, text);
  }

  async listBatches(deviceId: string): Promise<number[]> {
    return await this.listSeqs(this.opsDir(deviceId), 1);
  }

  async readBatch(deviceId: string, seq: number): Promise<string | null> {
    assertSeq(seq, 1);
    return await this.read(this.batchPath(deviceId, seq));
  }

  async writeBatch(deviceId: string, seq: number, text: string): Promise<void> {
    this.checkDevice(deviceId);
    assertSeq(seq, 1);
    await this.writeCreate(this.batchPath(deviceId, seq), text);
  }

  async deleteBatch(deviceId: string, seq: number): Promise<void> {
    this.checkDevice(deviceId);
    assertSeq(seq, 1);
    await this.deleteOptional(this.batchPath(deviceId, seq));
  }

  async listSnapshots(deviceId: string): Promise<number[]> {
    return await this.listSeqs(this.snapshotsDir(deviceId), 0);
  }

  async readSnapshot(deviceId: string, seq: number): Promise<string | null> {
    assertSeq(seq, 0);
    return await this.read(this.snapshotPath(deviceId, seq));
  }

  async writeSnapshot(deviceId: string, seq: number, text: string): Promise<void> {
    this.checkDevice(deviceId);
    assertSeq(seq, 0);
    await this.writeCreate(this.snapshotPath(deviceId, seq), text);
  }

  async deleteSnapshot(deviceId: string, seq: number): Promise<void> {
    this.checkDevice(deviceId);
    assertSeq(seq, 0);
    await this.deleteOptional(this.snapshotPath(deviceId, seq));
  }

  private checkDevice(deviceId: string): void {
    if (!isValidSyncDeviceId(deviceId)) {
      throw new Error("Invalid sync device id.");
    }
    if (deviceId !== this.localDeviceId) {
      throw new Error("This device cannot write into another device's sync folder.");
    }
  }

  /*
   * Path builders are read-safe: the engine reads every peer's journal, so the
   * "own device only" rule belongs in the write methods, not in the paths.
   */
  private metaPath(deviceId: string): string {
    this.checkReadDevice(deviceId);
    return `${DEVICES}/${deviceId}/meta.json`;
  }

  private opsDir(deviceId: string): string {
    this.checkReadDevice(deviceId);
    return `${DEVICES}/${deviceId}/ops`;
  }

  private snapshotsDir(deviceId: string): string {
    this.checkReadDevice(deviceId);
    return `${DEVICES}/${deviceId}/snapshots`;
  }

  private batchPath(deviceId: string, seq: number): string {
    this.checkReadDevice(deviceId);
    return `${this.opsDir(deviceId)}/${fileName(seq)}`;
  }

  private snapshotPath(deviceId: string, seq: number): string {
    this.checkReadDevice(deviceId);
    return `${this.snapshotsDir(deviceId)}/${fileName(seq)}`;
  }

  private checkReadDevice(deviceId: string): void {
    if (!isValidSyncDeviceId(deviceId)) {
      throw new Error("Invalid sync device id.");
    }
  }

  private async listSeqs(dir: string, min: number): Promise<number[]> {
    const entries = await listDirSafe(this.folderId, dir);
    return entries
      .filter((entry) => entry.isFile)
      .map((entry) => parseSeq(entry.name, min))
      .filter((seq): seq is number => seq !== null)
      .sort((a, b) => a - b);
  }

  private async read(path: string): Promise<string | null> {
    if (!(await exists(this.folderId, path))) return null;
    const info = await stat(this.folderId, path);
    if (info.isDir) throw new Error(`${path} is a folder, not a journal file.`);
    if (info.size != null && info.size > MAX_SYNC_FILE_BYTES) {
      throw new Error("That sync journal file is unexpectedly large.");
    }
    return await readTextFile(this.folderId, path);
  }

  /** Create without ever overwriting a peer's file. */
  private async writeCreate(path: string, text: string): Promise<void> {
    await ensureDir(this.folderId, parentOf(path));
    if (await exists(this.folderId, path)) {
      const current = await readTextFile(this.folderId, path);
      if (current === text) return;
      throw new Error("A different file already exists at that journal path.");
    }
    const temp = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await writeTextFile(this.folderId, temp, text, { recursive: true });
      await rename(this.folderId, temp, path);
    } catch (error) {
      try {
        await removeFile(this.folderId, temp);
      } catch {
        /* the temp file may never have been written */
      }
      throw error;
    }
  }

  /** Metadata is this device's own file, so replacing it is safe. */
  private async writeReplace(path: string, text: string): Promise<void> {
    await writeTextFile(this.folderId, path, text, { recursive: true });
  }

  private async deleteOptional(path: string): Promise<void> {
    if (!(await exists(this.folderId, path))) return;
    await removeFile(this.folderId, path);
  }

  /**
   * Starting a new workspace must not leave the previous workspace's device
   * folders where the new one would read them. The desktop archives instead of
   * deleting; iOS keeps the same escape hatch inside the chosen folder.
   */
  private async archiveDevices(): Promise<void> {
    const devices = await this.listDevices();
    if (devices.length === 0) return;
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const target = `archive/devices-${stamp}`;
    await ensureDir(this.folderId, target);
    for (const deviceId of devices) {
      await rename(this.folderId, `${DEVICES}/${deviceId}`, `${target}/${deviceId}`);
    }
  }
}

/** Whether this folder handle still grants access. */
export async function iosFolderStatus(folderId: string): Promise<SyncFolderStatus> {
  try {
    const info = await getFolderInfo(folderId);
    return { available: true, root: info.name || "Shared folder", reason: null };
  } catch (error) {
    return {
      available: false,
      root: null,
      reason:
        codeOf(error) === "FOLDER_NOT_FOUND"
          ? "Tempo lost access to this folder. Choose it again in the Files app."
          : messageOf(error),
    };
  }
}
