import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllData,
  createItem,
  db,
  getSetting,
  setSetting,
  updateItem,
} from "../../db/db";
import { FakePeer } from "./fakePeer";
import { FakeSyncFolder } from "./fakeFolder";
import {
  enableSync,
  joinExistingWorkspace,
  pauseSync,
  readSelectedSyncFolder,
  restoreConflict,
  startNewWorkspace,
  syncNow,
  type SyncSetup,
} from "./setup";
import { rowKey } from "./merge";

const IDENTITY = {
  deviceId: "mac",
  installId: "install-mac",
  deviceName: "Mac",
};

interface SavedBackup {
  name: string;
  json: string;
}

function setupFor(
  folder: FakeSyncFolder,
  backups: SavedBackup[] = [],
): SyncSetup {
  return {
    folder,
    identity: IDENTITY,
    folderLabel: "/Users/test/Tempo",
    saveBackup: async (json, name) => {
      backups.push({ name, json });
      return `/Users/test/Downloads/${name}`;
    },
  };
}

async function resetDatabase(): Promise<void> {
  await db.syncDevice.clear();
  await clearAllData();
  await db.settings.delete("sync.resetPending");
}

async function phoneWithItem(
  folder: FakeSyncFolder,
  workspaceId: string,
  title = "From phone",
): Promise<string> {
  const phone = new FakePeer(folder, "phone", workspaceId);
  const id = "shared-item";
  phone.put("items", {
    id,
    type: "task",
    title,
    status: "todo",
    tagIds: [],
    reminders: [],
    order: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  await phone.flush();
  await phone.writeSnapshot();
  return id;
}

describe("sync setup", () => {
  beforeAll(async () => {
    await db.open();
  });

  beforeEach(resetDatabase);

  it("creates a workspace, snapshots existing rows, and uploads later edits", async () => {
    const existing = await createItem({ type: "task", title: "Already here" });
    const folder = new FakeSyncFolder();
    const result = await enableSync(setupFor(folder));

    expect(result.status).toBe("enabled");
    if (result.status !== "enabled") return;

    const workspace = JSON.parse((await folder.readWorkspace()) ?? "{}") as {
      workspaceId: string;
    };
    expect(workspace.workspaceId).toBe(result.device.workspaceId);
    expect(result.device.enabled).toBe(true);
    expect(result.device.paused).toBe(false);
    expect(await folder.listSnapshots("mac")).toEqual([0]);

    const state = await db.syncState.get(rowKey("items", existing.id));
    expect(state).toMatchObject({ rev: 1, writer: "mac", deleted: false });

    const snapshot = JSON.parse((await folder.readSnapshot("mac", 0)) ?? "{}") as {
      rows: Array<{ id: string }>;
    };
    expect(snapshot.rows.map((row) => row.id)).toContain(existing.id);

    const later = await createItem({ type: "task", title: "Second" });
    const run = await syncNow(setupFor(folder));
    expect(run.flush.written).toBe(1);
    expect(await folder.listBatches("mac")).toEqual([1]);
    expect((await db.syncState.get(rowKey("items", later.id)))?.rev).toBe(1);
  });

  it("joins an existing workspace when this Mac has no work", async () => {
    const folder = new FakeSyncFolder();
    await folder.createWorkspace("ws_old", "phone");
    const shared = await phoneWithItem(folder, "ws_old");

    const result = await enableSync(setupFor(folder));

    expect(result.status).toBe("enabled");
    if (result.status !== "enabled") return;
    expect(result.device.workspaceId).toBe("ws_old");
    expect(await db.items.get(shared)).toMatchObject({ title: "From phone" });
    expect((await db.syncCursors.get("phone"))?.lastSeq).toBe(1);
  });

  it("blocks a join that would replace local work, then joins with a backup", async () => {
    const folder = new FakeSyncFolder();
    await folder.createWorkspace("ws_old", "phone");
    const shared = await phoneWithItem(folder, "ws_old");
    const local = await createItem({ type: "task", title: "Only here" });
    const backups: SavedBackup[] = [];

    const blocked = await enableSync(setupFor(folder, backups));
    expect(blocked).toMatchObject({ status: "blocked", reason: "local-work" });
    expect(await db.syncDevice.get("local")).toBeUndefined();

    const joined = await joinExistingWorkspace(setupFor(folder, backups));
    expect(joined.status).toBe("enabled");
    expect(backups).toHaveLength(1);
    expect(backups[0].json).toContain("Only here");
    expect(await db.items.get(local.id)).toBeUndefined();
    expect(await db.items.get(shared)).toMatchObject({ title: "From phone" });
  });

  it("keeps local work and archives the old folder when starting new", async () => {
    const folder = new FakeSyncFolder();
    await folder.createWorkspace("ws_old", "phone");
    await phoneWithItem(folder, "ws_old");
    const local = await createItem({ type: "task", title: "Keep me" });

    const blocked = await enableSync(setupFor(folder));
    expect(blocked).toMatchObject({ status: "blocked", reason: "local-work" });

    const started = await startNewWorkspace(setupFor(folder));
    expect(started.status).toBe("enabled");
    if (started.status !== "enabled") return;

    const workspace = JSON.parse((await folder.readWorkspace()) ?? "{}") as {
      workspaceId: string;
    };
    expect(workspace.workspaceId).not.toBe("ws_old");
    expect(started.device.workspaceId).toBe(workspace.workspaceId);
    expect(await folder.listDevices()).not.toContain("phone");
    expect(await db.items.get(local.id)).toMatchObject({ title: "Keep me" });
    const snapshot = JSON.parse((await folder.readSnapshot("mac", 0)) ?? "{}") as {
      rows: Array<{ id: string }>;
    };
    expect(snapshot.rows.map((row) => row.id)).toContain(local.id);
  });

  it("requires an explicit start-new after a reset, even with an empty database", async () => {
    const folder = new FakeSyncFolder();
    await folder.createWorkspace("ws_old", "phone");
    await setSetting("sync.resetPending", true);

    const blocked = await enableSync(setupFor(folder));
    expect(blocked).toMatchObject({ status: "blocked", reason: "reset" });
    expect(await getSetting<boolean>("sync.resetPending", false)).toBe(true);

    const started = await startNewWorkspace(setupFor(folder));
    expect(started.status).toBe("enabled");
    expect(await getSetting<boolean>("sync.resetPending", false)).toBe(false);
  });

  it("prefers the chosen folder path over an older device label", async () => {
    await setSetting("sync.folder-path", "/Users/test/Shared Tempo");
    await db.syncDevice.put({
      key: "local",
      deviceId: "mac",
      installId: "install-mac",
      workspaceId: "ws_old",
      deviceName: "Mac",
      lastSeq: 0,
      lastSnapshotSeq: 0,
      enabled: false,
      folderKind: "folder",
      folderLabel: "/Users/test/Old Tempo",
    });

    await expect(readSelectedSyncFolder()).resolves.toBe("/Users/test/Shared Tempo");
    await db.settings.delete("sync.folder-path");
    await expect(readSelectedSyncFolder()).resolves.toBe("/Users/test/Old Tempo");
  });

  it("pauses folder access, keeps journaling, and writes the backlog on resume", async () => {
    const folder = new FakeSyncFolder();
    const setup = setupFor(folder);
    const result = await enableSync(setup);
    expect(result.status).toBe("enabled");

    await createItem({ type: "task", title: "Before pause" });
    const paused = await pauseSync(setup);
    expect(paused).toMatchObject({ paused: true, pending: 0, error: null });
    expect((await db.syncDevice.get("local"))?.paused).toBe(true);
    expect(await folder.listBatches("mac")).toEqual([1]);

    await createItem({ type: "task", title: "While paused" });
    expect(await db.syncOutbox.count()).toBe(1);
    expect(await folder.listBatches("mac")).toEqual([1]);
    await expect(syncNow(setup)).rejects.toThrow("Turn sync back on");

    const resumed = await enableSync(setup);
    expect(resumed.status).toBe("enabled");
    expect(await folder.listBatches("mac")).toEqual([1, 2]);
    expect(await db.syncOutbox.count()).toBe(0);
    expect((await db.syncDevice.get("local"))?.paused).toBe(false);
  });

  it("can put a conflicted local copy back as a new revision", async () => {
    const folder = new FakeSyncFolder();
    const local = await createItem({ type: "task", title: "Mine" });
    const setup = setupFor(folder);
    const result = await enableSync(setup);
    expect(result.status).toBe("enabled");

    const phone = new FakePeer(folder, "phone", result.status === "enabled" ? result.device.workspaceId : "");
    await updateItem(local.id, { title: "Mine edited" });
    const remoteRow = {
      ...local,
      title: "Theirs",
    };
    phone.put("items", remoteRow);
    phone.put("items", { ...remoteRow, title: "Theirs again" });
    await phone.flush();

    const run = await syncNow(setup);
    expect(run.pull.conflicts).toBe(1);
    const conflict = await db.syncConflicts.orderBy("at").first();
    expect(conflict?.lostRow).toMatchObject({ title: "Mine edited" });
    expect(await db.items.get(local.id)).toMatchObject({ title: "Theirs again" });

    await restoreConflict(conflict!.id!);
    expect(await db.items.get(local.id)).toMatchObject({ title: "Mine edited" });
    expect(await db.syncConflicts.count()).toBe(0);
    expect(await db.syncOutbox.count()).toBe(1);
  });
});
