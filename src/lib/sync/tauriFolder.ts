import { isDesktop, isIOS } from "../desktop";
import { iosFolderStatus } from "./iosFolder";
import { isValidSyncDeviceId, type SyncFolder } from "./types";

/** The subset of Tauri's invoke signature used by the adapter. */
export type SyncInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export class SyncUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncUnavailableError";
  }
}

export class SyncNativeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncNativeError";
  }
}

export interface SyncFolderStatus {
  available: boolean;
  root: string | null;
  reason: string | null;
}

export interface TauriSyncFolderOptions {
  localDeviceId: string;
  /** The local folder the user chose for the journal. */
  rootPath: string;
  /** Injected by tests; production lazily loads the Tauri IPC bridge. */
  invoke?: SyncInvoke;
}

async function defaultInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isDesktop()) {
    throw new SyncUnavailableError(
      "Folder sync is available in the desktop app only.",
    );
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<T>(command, args);
}

function checkSeq(seq: number, min: number): void {
  if (!Number.isSafeInteger(seq) || seq < min) {
    throw new SyncNativeError("Invalid sync sequence.");
  }
}

/**
 * The desktop SyncFolder. JavaScript supplies only the folder the user picked;
 * the native side owns the journal paths, atomic writes and local-device
 * enforcement. It never talks to iCloud, Dropbox or another sync provider.
 */
export class TauriSyncFolder implements SyncFolder {
  readonly localDeviceId: string;
  readonly rootPath: string;
  private readonly invoke: SyncInvoke;
  private folderReady: Promise<void> | null = null;
  private deviceReady: Promise<void> | null = null;

  constructor(options: TauriSyncFolderOptions) {
    if (!isValidSyncDeviceId(options.localDeviceId)) {
      throw new SyncNativeError("Invalid local sync device id.");
    }
    if (!options.rootPath.trim()) {
      throw new SyncNativeError("Choose a folder for sync first.");
    }
    this.localDeviceId = options.localDeviceId;
    this.rootPath = options.rootPath;
    this.invoke = options.invoke ?? defaultInvoke;
  }

  async status(): Promise<SyncFolderStatus> {
    await this.ensureFolder();
    return await this.invoke<SyncFolderStatus>("sync_status");
  }

  async readWorkspace(): Promise<string | null> {
    await this.ensureReady();
    return await this.invoke<string | null>("sync_read_workspace");
  }

  async writeWorkspace(text: string, options?: { replace?: boolean }): Promise<void> {
    await this.ensureReady();
    await this.invoke("sync_write_workspace", {
      text,
      replace: options?.replace ?? false,
    });
  }

  async listDevices(): Promise<string[]> {
    await this.ensureReady();
    return await this.invoke<string[]>("sync_list_devices");
  }

  async readMeta(deviceId: string): Promise<string | null> {
    this.checkReadDevice(deviceId);
    await this.ensureReady();
    return await this.invoke<string | null>("sync_read_meta", { deviceId });
  }

  async writeMeta(deviceId: string, text: string): Promise<void> {
    this.checkWriteDevice(deviceId);
    await this.ensureReady();
    await this.invoke("sync_write_meta", { deviceId, text });
  }

  async listBatches(deviceId: string): Promise<number[]> {
    this.checkReadDevice(deviceId);
    await this.ensureReady();
    return await this.invoke<number[]>("sync_list_batches", { deviceId });
  }

  async readBatch(deviceId: string, seq: number): Promise<string | null> {
    this.checkReadDevice(deviceId);
    checkSeq(seq, 1);
    await this.ensureReady();
    return await this.invoke<string | null>("sync_read_batch", { deviceId, seq });
  }

  async writeBatch(deviceId: string, seq: number, text: string): Promise<void> {
    this.checkWriteDevice(deviceId);
    checkSeq(seq, 1);
    await this.ensureReady();
    await this.invoke("sync_write_batch", { deviceId, seq, text });
  }

  async deleteBatch(deviceId: string, seq: number): Promise<void> {
    this.checkWriteDevice(deviceId);
    checkSeq(seq, 1);
    await this.ensureReady();
    await this.invoke("sync_delete_batch", { deviceId, seq });
  }

  async listSnapshots(deviceId: string): Promise<number[]> {
    this.checkReadDevice(deviceId);
    await this.ensureReady();
    return await this.invoke<number[]>("sync_list_snapshots", { deviceId });
  }

  async readSnapshot(deviceId: string, seq: number): Promise<string | null> {
    this.checkReadDevice(deviceId);
    checkSeq(seq, 0);
    await this.ensureReady();
    return await this.invoke<string | null>("sync_read_snapshot", { deviceId, seq });
  }

  async writeSnapshot(deviceId: string, seq: number, text: string): Promise<void> {
    this.checkWriteDevice(deviceId);
    checkSeq(seq, 0);
    await this.ensureReady();
    await this.invoke("sync_write_snapshot", { deviceId, seq, text });
  }

  async deleteSnapshot(deviceId: string, seq: number): Promise<void> {
    this.checkWriteDevice(deviceId);
    checkSeq(seq, 0);
    await this.ensureReady();
    await this.invoke("sync_delete_snapshot", { deviceId, seq });
  }

  private checkReadDevice(deviceId: string): void {
    if (!isValidSyncDeviceId(deviceId)) {
      throw new SyncNativeError("Invalid sync device id.");
    }
  }

  private checkWriteDevice(deviceId: string): void {
    this.checkReadDevice(deviceId);
    if (deviceId !== this.localDeviceId) {
      throw new SyncNativeError("This device cannot write into another device's sync folder.");
    }
  }

  /** Register the chosen folder lazily, after a webview reload or launch. */
  private ensureFolder(): Promise<void> {
    if (!this.folderReady) {
      const ready = this.invoke<void>("sync_set_folder", {
        path: this.rootPath,
      }).then(() => undefined);
      this.folderReady = ready;
      ready.catch(() => {
        if (this.folderReady === ready) this.folderReady = null;
      });
    }
    return this.folderReady;
  }

  /**
   * Register the local device lazily. Tauri state resets when the window
   * reloads, so a fresh adapter sets it again on its first operation.
   */
  private ensureDevice(): Promise<void> {
    if (!this.deviceReady) {
      const ready = this.invoke<void>("sync_set_device", {
        deviceId: this.localDeviceId,
      }).then(() => undefined);
      this.deviceReady = ready;
      ready.catch(() => {
        if (this.deviceReady === ready) this.deviceReady = null;
      });
    }
    return this.deviceReady;
  }

  private async ensureReady(): Promise<void> {
    await this.ensureFolder();
    await this.ensureDevice();
  }
}

/** Ask whether the native layer can use this folder. */
export async function syncFolderStatus(
  rootPath: string,
  invoke: SyncInvoke = defaultInvoke,
): Promise<SyncFolderStatus> {
  // On iOS the stored "path" is the scoped-storage folder handle, not a path.
  if (isIOS()) return await iosFolderStatus(rootPath);
  return await invoke<SyncFolderStatus>("sync_set_folder", { path: rootPath });
}
