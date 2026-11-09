import { constants } from "node:fs";
import {
  copyFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  isValidSyncDeviceId,
  MAX_SYNC_FILE_BYTES,
  SYNC_FORMAT_VERSION,
  type SyncFolder,
} from "./types";

export class SyncFolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncFolderError";
  }
}

function checkDeviceId(deviceId: string): string {
  if (!isValidSyncDeviceId(deviceId)) {
    throw new SyncFolderError("Invalid sync device id.");
  }
  return deviceId;
}

function checkSeq(seq: number, min: number): number {
  if (!Number.isSafeInteger(seq) || seq < min) {
    throw new SyncFolderError("Invalid sync sequence.");
  }
  return seq;
}

function fileName(seq: number): string {
  return `${String(seq).padStart(8, "0")}.json`;
}

function parseSeq(name: string): number | null {
  const match = /^(\d+)\.json$/.exec(name);
  return match ? Number(match[1]) : null;
}

function isErrno(error: unknown, ...codes: string[]): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    codes.includes((error as NodeJS.ErrnoException).code ?? "")
  );
}

export interface DiskSyncFolderOptions {
  /**
   * When supplied, this adapter behaves like the native layer for one device:
   * writes and deletes into any other device's folder are rejected.
   */
  localDeviceId?: string;
}

/**
 * A real-filesystem stand-in for the chosen sync folder. It has the same
 * layout and the same create-if-absent, idempotent-write rules as the native
 * adapter, so the convergence suite exercises actual files, atomic moves, and
 * restarts.
 *
 * Test-only: the app bundle never imports this module. Node's filesystem is
 * not available in the browser or the native folder bridge.
 */
export class DiskSyncFolder implements SyncFolder {
  constructor(
    readonly root: string,
    private readonly options: DiskSyncFolderOptions = {},
  ) {}

  async readWorkspace(): Promise<string | null> {
    return this.readText(join(this.root, "workspace.json"));
  }

  async writeWorkspace(text: string, options?: { replace?: boolean }): Promise<void> {
    if (options?.replace) await this.archiveDevices();
    await this.writeAtomic(
      join(this.root, "workspace.json"),
      text,
      options?.replace ? "replace" : "create",
    );
  }

  /** Replace is the explicit start-new path; old journals become archives. */
  private async archiveDevices(): Promise<void> {
    const devices = join(this.root, "devices");
    try {
      const info = await stat(devices);
      if (!info.isDirectory()) return;
    } catch (error) {
      if (isErrno(error, "ENOENT")) return;
      throw error;
    }
    const archive = join(this.root, "archive");
    await mkdir(archive, { recursive: true });
    const target = join(archive, `devices-${Date.now()}-${randomUUID()}`);
    await rename(devices, target);
  }

  async createWorkspace(
    workspaceId: string,
    createdBy = "test",
    createdAt = Date.now(),
  ): Promise<void> {
    await this.writeWorkspace(
      JSON.stringify({
        format: "tempo-sync-workspace",
        version: SYNC_FORMAT_VERSION,
        workspaceId,
        createdAt,
        createdBy,
      }),
    );
  }

  async listDevices(): Promise<string[]> {
    const entries = await this.listDirectory(join(this.root, "devices"));
    return entries
      .filter((entry) => entry.isDirectory() && isValidSyncDeviceId(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  async readMeta(deviceId: string): Promise<string | null> {
    checkDeviceId(deviceId);
    return this.readText(this.metaPath(deviceId));
  }

  async writeMeta(deviceId: string, text: string): Promise<void> {
    checkDeviceId(deviceId);
    this.assertLocal(deviceId);
    await this.writeAtomic(this.metaPath(deviceId), text, "replace");
  }

  async listBatches(deviceId: string): Promise<number[]> {
    checkDeviceId(deviceId);
    return this.listSeqs(this.prefix(deviceId, "ops"), 1);
  }

  async readBatch(deviceId: string, seq: number): Promise<string | null> {
    checkDeviceId(deviceId);
    checkSeq(seq, 1);
    return this.readText(this.opPath(deviceId, seq));
  }

  async writeBatch(deviceId: string, seq: number, text: string): Promise<void> {
    checkDeviceId(deviceId);
    checkSeq(seq, 1);
    this.assertLocal(deviceId);
    await this.writeAtomic(this.opPath(deviceId, seq), text, "create");
  }

  async deleteBatch(deviceId: string, seq: number): Promise<void> {
    checkDeviceId(deviceId);
    checkSeq(seq, 1);
    this.assertLocal(deviceId);
    await rm(this.opPath(deviceId, seq), { force: true });
  }

  async listSnapshots(deviceId: string): Promise<number[]> {
    checkDeviceId(deviceId);
    return this.listSeqs(this.prefix(deviceId, "snapshots"), 0);
  }

  async readSnapshot(deviceId: string, seq: number): Promise<string | null> {
    checkDeviceId(deviceId);
    checkSeq(seq, 0);
    return this.readText(this.snapshotPath(deviceId, seq));
  }

  async writeSnapshot(deviceId: string, seq: number, text: string): Promise<void> {
    checkDeviceId(deviceId);
    checkSeq(seq, 0);
    this.assertLocal(deviceId);
    await this.writeAtomic(this.snapshotPath(deviceId, seq), text, "create");
  }

  async deleteSnapshot(deviceId: string, seq: number): Promise<void> {
    checkDeviceId(deviceId);
    checkSeq(seq, 0);
    this.assertLocal(deviceId);
    await rm(this.snapshotPath(deviceId, seq), { force: true });
  }

  private prefix(deviceId: string, kind: "ops" | "snapshots"): string {
    return join(this.root, "devices", deviceId, kind);
  }

  private metaPath(deviceId: string): string {
    return join(this.root, "devices", deviceId, "meta.json");
  }

  private opPath(deviceId: string, seq: number): string {
    return join(this.prefix(deviceId, "ops"), fileName(seq));
  }

  private snapshotPath(deviceId: string, seq: number): string {
    return join(this.prefix(deviceId, "snapshots"), fileName(seq));
  }

  private assertLocal(deviceId: string): void {
    if (this.options.localDeviceId && deviceId !== this.options.localDeviceId) {
      throw new SyncFolderError("This device cannot write into another device's folder.");
    }
  }

  private async listDirectory(
    directory: string,
  ): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>> {
    try {
      return await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isErrno(error, "ENOENT")) return [];
      throw error;
    }
  }

  private async listSeqs(directory: string, min: number): Promise<number[]> {
    const entries = await this.listDirectory(directory);
    const seqs: number[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const seq = parseSeq(entry.name);
      if (seq !== null && seq >= min) seqs.push(seq);
    }
    return seqs.sort((a, b) => a - b);
  }

  private async readText(file: string): Promise<string | null> {
    try {
      const info = await stat(file);
      if (!info.isFile()) return null;
      if (info.size > MAX_SYNC_FILE_BYTES) {
        throw new SyncFolderError("That sync file is larger than this version supports.");
      }
      return await readFile(file, "utf8");
    } catch (error) {
      if (isErrno(error, "ENOENT")) return null;
      throw error;
    }
  }

  /**
   * Writes beside the sync root, then links or renames into place. The temp
   * file is never visible inside the workspace; a crash cannot leave a
   * half-written batch at its final path.
   */
  private async writeAtomic(
    target: string,
    text: string,
    mode: "create" | "replace",
  ): Promise<void> {
    await mkdir(dirname(target), { recursive: true });
    const temp = join(dirname(this.root), `.tempo-sync-${randomUUID()}.tmp`);
    await writeFile(temp, text, { encoding: "utf8", mode: 0o600 });
    try {
      if (mode === "replace") {
        await this.replace(temp, target);
        return;
      }
      await this.create(temp, target, text);
    } finally {
      await rm(temp, { force: true });
    }
  }

  private async create(temp: string, target: string, text: string): Promise<void> {
    try {
      // A hard link is atomic and fails if the target already exists, which is
      // exactly the idempotent create-if-absent contract of the native layer.
      await link(temp, target);
      return;
    } catch (error) {
      if (isErrno(error, "EEXIST")) {
        await this.assertSameText(target, text);
        return;
      }
      if (!isErrno(error, "EPERM", "ENOSYS", "EXDEV", "EMLINK")) throw error;
    }

    try {
      await copyFile(temp, target, constants.COPYFILE_EXCL);
    } catch (error) {
      if (isErrno(error, "EEXIST")) {
        await this.assertSameText(target, text);
        return;
      }
      throw error;
    }
  }

  private async replace(temp: string, target: string): Promise<void> {
    try {
      await rename(temp, target);
    } catch (error) {
      if (!isErrno(error, "EEXIST", "EPERM", "ENOTEMPTY")) throw error;
      // Windows cannot rename over an existing file. Meta is advisory, so a
      // brief gap here is acceptable; batch/snapshot writes use create mode.
      await rm(target, { force: true });
      await rename(temp, target);
    }
  }

  private async assertSameText(target: string, text: string): Promise<void> {
    const existing = await this.readText(target);
    if (existing !== text) {
      throw new SyncFolderError("That sync file already exists with different content.");
    }
  }
}
