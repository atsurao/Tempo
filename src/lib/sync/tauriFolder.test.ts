import { describe, expect, it } from "vitest";
import {
  SyncNativeError,
  SyncUnavailableError,
  TauriSyncFolder,
  syncFolderStatus,
  type SyncInvoke,
} from "./tauriFolder";

interface Call {
  command: string;
  args: Record<string, unknown> | undefined;
}

const ROOT = "/Users/test/Tempo";

function recorder(): { calls: Call[]; invoke: SyncInvoke } {
  const calls: Call[] = [];
  const invoke: SyncInvoke = async <T,>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    calls.push({ command, args });
    if (command === "sync_set_folder" || command === "sync_status") {
      return {
        available: true,
        root: ROOT,
        reason: null,
      } as T;
    }
    if (command === "sync_list_devices") return ["mac", "phone"] as T;
    if (command.startsWith("sync_list_")) return [] as T;
    if (command.startsWith("sync_read_")) return null as T;
    return undefined as T;
  };
  return { calls, invoke };
}

describe("TauriSyncFolder", () => {
  it("maps reads onto the native commands after registering the folder", async () => {
    const { calls, invoke } = recorder();
    const folder = new TauriSyncFolder({
      localDeviceId: "mac",
      rootPath: ROOT,
      invoke,
    });

    await expect(folder.readWorkspace()).resolves.toBeNull();
    await expect(folder.listDevices()).resolves.toEqual(["mac", "phone"]);
    await expect(folder.readMeta("phone")).resolves.toBeNull();
    await expect(folder.listBatches("phone")).resolves.toEqual([]);
    await expect(folder.readBatch("phone", 2)).resolves.toBeNull();
    await expect(folder.listSnapshots("phone")).resolves.toEqual([]);
    await expect(folder.readSnapshot("phone", 0)).resolves.toBeNull();

    expect(calls).toEqual([
      { command: "sync_set_folder", args: { path: ROOT } },
      { command: "sync_set_device", args: { deviceId: "mac" } },
      { command: "sync_read_workspace", args: undefined },
      { command: "sync_list_devices", args: undefined },
      { command: "sync_read_meta", args: { deviceId: "phone" } },
      { command: "sync_list_batches", args: { deviceId: "phone" } },
      { command: "sync_read_batch", args: { deviceId: "phone", seq: 2 } },
      { command: "sync_list_snapshots", args: { deviceId: "phone" } },
      { command: "sync_read_snapshot", args: { deviceId: "phone", seq: 0 } },
    ]);
  });

  it("registers the folder and local device once before concurrent writes", async () => {
    const { calls, invoke } = recorder();
    const folder = new TauriSyncFolder({
      localDeviceId: "mac",
      rootPath: ROOT,
      invoke,
    });

    await Promise.all([
      folder.writeBatch("mac", 1, "one"),
      folder.writeBatch("mac", 2, "two"),
    ]);

    expect(calls.filter((call) => call.command === "sync_set_folder")).toEqual([
      { command: "sync_set_folder", args: { path: ROOT } },
    ]);
    expect(calls.filter((call) => call.command === "sync_set_device")).toEqual([
      { command: "sync_set_device", args: { deviceId: "mac" } },
    ]);
    expect(calls.slice(2)).toEqual([
      { command: "sync_write_batch", args: { deviceId: "mac", seq: 1, text: "one" } },
      { command: "sync_write_batch", args: { deviceId: "mac", seq: 2, text: "two" } },
    ]);
  });

  it("maps workspace, meta, snapshot and delete writes", async () => {
    const { calls, invoke } = recorder();
    const folder = new TauriSyncFolder({
      localDeviceId: "mac",
      rootPath: ROOT,
      invoke,
    });

    await folder.writeWorkspace("workspace");
    await folder.writeWorkspace("replaced", { replace: true });
    await folder.writeMeta("mac", "meta");
    await folder.writeSnapshot("mac", 0, "snapshot");
    await folder.deleteBatch("mac", 3);
    await folder.deleteSnapshot("mac", 0);

    expect(calls).toEqual([
      { command: "sync_set_folder", args: { path: ROOT } },
      { command: "sync_set_device", args: { deviceId: "mac" } },
      {
        command: "sync_write_workspace",
        args: { text: "workspace", replace: false },
      },
      {
        command: "sync_write_workspace",
        args: { text: "replaced", replace: true },
      },
      { command: "sync_write_meta", args: { deviceId: "mac", text: "meta" } },
      {
        command: "sync_write_snapshot",
        args: { deviceId: "mac", seq: 0, text: "snapshot" },
      },
      { command: "sync_delete_batch", args: { deviceId: "mac", seq: 3 } },
      { command: "sync_delete_snapshot", args: { deviceId: "mac", seq: 0 } },
    ]);
  });

  it("refuses to write into a peer folder before invoking the bridge", async () => {
    const { calls, invoke } = recorder();
    const folder = new TauriSyncFolder({
      localDeviceId: "mac",
      rootPath: ROOT,
      invoke,
    });

    await expect(folder.writeBatch("phone", 1, "nope")).rejects.toThrow(
      SyncNativeError,
    );
    await expect(folder.writeSnapshot("phone", 0, "nope")).rejects.toThrow(
      SyncNativeError,
    );
    await expect(folder.deleteBatch("phone", 1)).rejects.toThrow(SyncNativeError);
    await expect(folder.writeMeta("phone", "nope")).rejects.toThrow(SyncNativeError);
    expect(calls).toEqual([]);
  });

  it("rejects invalid ids, sequences and empty roots before invoking", async () => {
    const { calls, invoke } = recorder();
    expect(
      () =>
        new TauriSyncFolder({
          localDeviceId: "../escape",
          rootPath: ROOT,
          invoke,
        }),
    ).toThrow(SyncNativeError);
    expect(
      () => new TauriSyncFolder({ localDeviceId: "mac", rootPath: "  ", invoke }),
    ).toThrow("Choose a folder");

    const folder = new TauriSyncFolder({
      localDeviceId: "mac",
      rootPath: ROOT,
      invoke,
    });
    await expect(folder.readBatch("has space", 1)).rejects.toThrow(SyncNativeError);
    await expect(folder.readBatch("mac", 0)).rejects.toThrow(SyncNativeError);
    await expect(folder.writeSnapshot("mac", -1, "x")).rejects.toThrow(
      SyncNativeError,
    );
    expect(calls).toEqual([]);
  });

  it("retries folder registration after a failed setup", async () => {
    const calls: string[] = [];
    let fail = true;
    const invoke: SyncInvoke = async <T,>(command: string): Promise<T> => {
      calls.push(command);
      if (command === "sync_set_folder" && fail) {
        fail = false;
        throw new Error("folder unavailable");
      }
      return undefined as T;
    };
    const folder = new TauriSyncFolder({
      localDeviceId: "mac",
      rootPath: ROOT,
      invoke,
    });

    await expect(folder.writeBatch("mac", 1, "one")).rejects.toThrow(
      "folder unavailable",
    );
    await folder.writeBatch("mac", 1, "one");
    expect(calls).toEqual([
      "sync_set_folder",
      "sync_set_folder",
      "sync_set_device",
      "sync_write_batch",
    ]);
  });

  it("reports folder status and fails cleanly outside the desktop shell", async () => {
    const { invoke } = recorder();
    await expect(syncFolderStatus(ROOT, invoke)).resolves.toMatchObject({
      available: true,
      root: ROOT,
    });

    const browser = new TauriSyncFolder({ localDeviceId: "mac", rootPath: ROOT });
    await expect(browser.readWorkspace()).rejects.toThrow(SyncUnavailableError);
  });

  it("exposes the chosen folder through status", async () => {
    const { calls, invoke } = recorder();
    const folder = new TauriSyncFolder({
      localDeviceId: "mac",
      rootPath: ROOT,
      invoke,
    });

    await expect(folder.status()).resolves.toMatchObject({
      available: true,
      root: ROOT,
    });
    expect(calls).toEqual([
      { command: "sync_set_folder", args: { path: ROOT } },
      { command: "sync_status", args: undefined },
    ]);
  });
});
