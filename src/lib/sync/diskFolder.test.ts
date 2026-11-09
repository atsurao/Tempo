import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskSyncFolder, SyncFolderError } from "./diskFolder";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tempo-disk-sync-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DiskSyncFolder", () => {
  it("creates a workspace only once and replaces it only when asked", async () => {
    const folder = new DiskSyncFolder(await tempRoot());
    await folder.createWorkspace("ws_one", "mac");
    expect(await folder.readWorkspace()).toContain("ws_one");

    await expect(folder.createWorkspace("ws_two", "phone")).rejects.toThrow(SyncFolderError);
    expect(await folder.readWorkspace()).toContain("ws_one");

    await folder.writeWorkspace(
      JSON.stringify({
        format: "tempo-sync-workspace",
        version: 1,
        workspaceId: "ws_two",
        createdAt: 2,
        createdBy: "phone",
      }),
      { replace: true },
    );
    expect(await folder.readWorkspace()).toContain("ws_two");
  });

  it("treats identical batch bytes as idempotent and different bytes as corruption", async () => {
    const folder = new DiskSyncFolder(await tempRoot());
    await folder.writeBatch("mac", 2, "two");
    await folder.writeBatch("mac", 2, "two");
    await folder.writeBatch("mac", 1, "one");

    expect(await folder.listBatches("mac")).toEqual([1, 2]);
    expect(await folder.readBatch("mac", 2)).toBe("two");
    await expect(folder.writeBatch("mac", 2, "changed")).rejects.toThrow(SyncFolderError);
  });

  it("lists devices and files numerically, and deletes only owned files", async () => {
    const root = await tempRoot();
    const mac = new DiskSyncFolder(root, { localDeviceId: "mac" });
    const admin = new DiskSyncFolder(root);

    await mac.writeMeta("mac", "{}");
    await mac.writeBatch("mac", 10, "ten");
    await mac.writeBatch("mac", 2, "two");
    await mac.writeSnapshot("mac", 0, "zero");
    await admin.writeBatch("phone", 1, "one");
    await mkdir(join(root, "devices", "not a device"), { recursive: true });

    expect(await admin.listDevices()).toEqual(["mac", "phone"]);
    expect(await mac.listBatches("mac")).toEqual([2, 10]);
    expect(await mac.listSnapshots("mac")).toEqual([0]);

    await expect(mac.writeBatch("phone", 2, "no")).rejects.toThrow(/another device/);
    await expect(mac.deleteBatch("phone", 1)).rejects.toThrow(/another device/);
    await expect(mac.writeMeta("phone", "{}")).rejects.toThrow(/another device/);

    await mac.deleteBatch("mac", 2);
    expect(await mac.listBatches("mac")).toEqual([10]);
  });

  it("writes meta by replacement and leaves no temporary files in the workspace", async () => {
    const root = await tempRoot();
    const folder = new DiskSyncFolder(root, { localDeviceId: "mac" });
    await folder.writeMeta("mac", "first");
    await folder.writeMeta("mac", "second");
    expect(await folder.readMeta("mac")).toBe("second");

    await folder.writeBatch("mac", 1, "one");
    await folder.writeSnapshot("mac", 1, "snapshot");

    const entries = await readdir(root, { recursive: true });
    expect(entries.some((entry) => entry.includes(".tmp"))).toBe(false);
  });

  it("rejects invalid device ids, sequences, and missing files cleanly", async () => {
    const folder = new DiskSyncFolder(await tempRoot());
    await expect(folder.readBatch("../escape", 1)).rejects.toThrow(SyncFolderError);
    await expect(folder.writeBatch("mac", 0, "zero")).rejects.toThrow(SyncFolderError);
    await expect(folder.writeBatch("mac", 1.5, "fraction")).rejects.toThrow(SyncFolderError);
    await expect(folder.readBatch("mac", 1)).resolves.toBeNull();
    await expect(folder.readSnapshot("mac", 0)).resolves.toBeNull();
    expect(await folder.listBatches("missing")).toEqual([]);
    expect(await folder.listDevices()).toEqual([]);
  });
});
