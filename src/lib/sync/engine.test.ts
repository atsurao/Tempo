import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllData,
  createItem,
  db,
  updateItem,
} from "../../db/db";
import { FakePeer } from "./fakePeer";
import { FakeSyncFolder } from "./fakeFolder";
import { SyncEngine } from "./engine";
import type { SyncDeviceRow } from "./types";

const WORKSPACE = "ws_engine";

async function enable(deviceId = "mac"): Promise<SyncDeviceRow> {
  const device: SyncDeviceRow = {
    key: "local",
    deviceId,
    installId: `install-${deviceId}`,
    workspaceId: WORKSPACE,
    deviceName: deviceId,
    lastSeq: 0,
    lastSnapshotSeq: 0,
    enabled: true,
    folderKind: "folder",
    folderLabel: null,
  };
  await db.syncDevice.put(device);
  return device;
}

describe("SyncEngine", () => {
  beforeAll(async () => {
    await db.open();
  });

  beforeEach(async () => {
    await db.syncDevice.clear();
    await clearAllData();
  });

  it("flushes the outbox in order and removes written rows", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);

    const item = await createItem({ type: "task", title: "First" });
    await updateItem(item.id, { title: "Second" });

    const result = await engine.flush();

    expect(result.status).toBe("written");
    expect(result.written).toBe(2);
    expect(result.pending).toBe(0);
    expect(result.error).toBeNull();
    expect(await folder.listBatches("mac")).toEqual([1, 2]);
    expect(await db.syncOutbox.count()).toBe(0);
    expect((await db.syncDevice.get("local"))?.lastSeq).toBe(2);

    const meta = JSON.parse((await folder.readMeta("mac")) ?? "{}") as {
      lastSeq: number;
      applied: Record<string, number>;
    };
    expect(meta.lastSeq).toBe(2);
    expect(meta.applied).toEqual({});

    const phone = new FakePeer(folder, "phone", WORKSPACE);
    await phone.pull();
    expect(phone.get("items", item.id)?.title).toBe("Second");
  });

  it("serializes concurrent flush calls", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);

    await createItem({ type: "task", title: "One" });
    await createItem({ type: "task", title: "Two" });

    const [first, second] = await Promise.all([engine.flush(), engine.flush()]);

    expect(first.written + second.written).toBe(2);
    expect(await folder.listBatches("mac")).toEqual([1, 2]);
    expect(await db.syncOutbox.count()).toBe(0);
  });

  it("flushes local work before applying peers in one sync call", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);
    const phone = new FakePeer(folder, "phone", WORKSPACE);

    phone.put("items", { id: "remote", type: "task", title: "Remote" });
    await phone.flush();
    await createItem({ type: "task", title: "Local" });

    const result = await engine.sync();
    expect(result.flush).toMatchObject({ status: "written", written: 1, pending: 0 });
    expect(result.pull).toMatchObject({ status: "applied", appliedBatches: 1 });
    expect(await folder.listBatches("mac")).toEqual([1]);
    expect(await db.items.get("remote")).toMatchObject({ title: "Remote" });
  });

  it("applies remote batches and records a losing local row", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);
    const phone = new FakePeer(folder, "phone", WORKSPACE);

    const remote = {
      id: "i1",
      type: "task" as const,
      title: "remote",
      createdAt: 1,
      updatedAt: 1,
    };
    phone.put("items", remote);
    await phone.flush();

    const initial = await engine.pull();
    expect(initial.status).toBe("applied");
    expect(initial.appliedBatches).toBe(1);
    expect(await db.items.get("i1")).toMatchObject({ title: "remote" });
    expect(await db.syncCursors.get("phone")).toMatchObject({
      lastSeq: 1,
      lastSnapshotSeq: 0,
    });

    await updateItem("i1", { title: "mac edit" });
    phone.put("items", { ...remote, title: "phone edit" });
    await phone.flush();

    const conflict = await engine.pull();
    expect(conflict.status).toBe("applied");
    expect(conflict.conflicts).toBe(1);
    expect(await db.items.get("i1")).toMatchObject({ title: "phone edit" });

    const conflicts = await db.syncConflicts.toArray();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      table: "items",
      rowId: "i1",
      winner: "remote",
      localRev: 2,
      remoteRev: 2,
      lostRow: { title: "mac edit" },
    });

    const flushed = await engine.flush();
    expect(flushed.written).toBe(1);
    await phone.pull();
    expect(phone.get("items", "i1")?.title).toBe("phone edit");
  });

  it("does not report a conflict when a peer edits a row created here", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);
    const item = await createItem({ type: "task", title: "Created here" });
    await engine.flush();

    const phone = new FakePeer(folder, "phone", WORKSPACE);
    await phone.pull();
    const onPhone = phone.get("items", item.id)!;
    phone.put("items", { ...onPhone, title: "Edited on phone" });
    await phone.flush();

    const pulled = await engine.pull();
    expect(pulled.conflicts).toBe(0);
    expect(await db.syncConflicts.count()).toBe(0);
    expect(await db.items.get(item.id)).toMatchObject({ title: "Edited on phone" });
  });

  it("does not report a conflict when a peer deletes an untouched row", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);
    const phone = new FakePeer(folder, "phone", WORKSPACE);

    phone.put("items", {
      id: "remote-delete",
      type: "task",
      title: "Remote",
      createdAt: 1,
      updatedAt: 1,
    });
    await phone.flush();
    await engine.pull();
    expect(await db.items.get("remote-delete")).toMatchObject({ title: "Remote" });

    phone.del("items", "remote-delete");
    await phone.flush();
    const pulled = await engine.pull();

    expect(pulled.conflicts).toBe(0);
    expect(await db.items.get("remote-delete")).toBeUndefined();
    expect(await db.syncConflicts.count()).toBe(0);
  });

  it("still reports a delete conflict when the local row was edited", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);
    const phone = new FakePeer(folder, "phone", WORKSPACE);

    phone.put("items", {
      id: "edited-delete",
      type: "task",
      title: "Remote",
      createdAt: 1,
      updatedAt: 1,
    });
    await phone.flush();
    await engine.pull();

    await updateItem("edited-delete", { title: "Edited here" });
    phone.del("items", "edited-delete");
    await phone.flush();
    const pulled = await engine.pull();

    expect(pulled.conflicts).toBe(1);
    const conflict = await db.syncConflicts.orderBy("at").first();
    expect(conflict?.lostRow).toMatchObject({ title: "Edited here" });
    expect(await db.items.get("edited-delete")).toBeUndefined();
  });

  it("does not report a conflict when a peer edits after pulling this device's latest revision", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);
    const item = await createItem({ type: "task", title: "First" });
    await engine.flush();

    const phone = new FakePeer(folder, "phone", WORKSPACE);
    await phone.pull();
    phone.put("items", { ...phone.get("items", item.id)!, title: "Phone first" });
    await phone.flush();
    await engine.pull();

    await updateItem(item.id, { title: "Mac second" });
    await engine.flush();
    await phone.pull();
    phone.put("items", { ...phone.get("items", item.id)!, title: "Phone second" });
    await phone.flush();

    const pulled = await engine.pull();
    expect(pulled.conflicts).toBe(0);
    expect(await db.syncConflicts.count()).toBe(0);
    expect(await db.items.get(item.id)).toMatchObject({ title: "Phone second" });
  });

  it("does not add another conflict for edits after a same-field conflict", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);
    const item = await createItem({ type: "task", title: "Base" });
    await engine.flush();

    const phone = new FakePeer(folder, "phone", WORKSPACE);
    await phone.pull();
    await updateItem(item.id, { title: "Mac first" });
    phone.put("items", { ...phone.get("items", item.id)!, title: "Phone first" });
    await phone.flush();

    const first = await engine.pull();
    expect(first.conflicts).toBe(1);
    expect(await db.items.get(item.id)).toMatchObject({ title: "Phone first" });

    await updateItem(item.id, { title: "Mac after" });
    await engine.flush();
    await phone.pull();
    expect(phone.conflicts).toHaveLength(0);
    expect(phone.get("items", item.id)).toMatchObject({ title: "Mac after" });

    phone.put("items", { ...phone.get("items", item.id)!, title: "Phone after" });
    await phone.flush();
    const second = await engine.pull();
    expect(second.conflicts).toBe(0);
    expect(await db.syncConflicts.count()).toBe(1);
    expect(await db.items.get(item.id)).toMatchObject({ title: "Phone after" });
  });

  it("combines concurrent edits to different fields and publishes the result", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);

    const item = await createItem({ type: "task", title: "Base" });
    await engine.flush();
    const phone = new FakePeer(folder, "phone", WORKSPACE);
    await phone.pull();

    await updateItem(item.id, { title: "Mac title" });
    const onPhone = phone.get("items", item.id);
    phone.put("items", { ...onPhone!, dueAt: 123 });
    await phone.flush();

    const pulled = await engine.pull();
    expect(pulled.status).toBe("applied");
    expect(pulled.merged).toBe(1);
    expect(pulled.conflicts).toBe(0);
    expect(await db.syncConflicts.count()).toBe(0);
    expect(await db.items.get(item.id)).toMatchObject({
      title: "Mac title",
      dueAt: 123,
    });

    const flushed = await engine.flush();
    expect(flushed.written).toBe(2);
    await phone.pull();
    expect(phone.get("items", item.id)).toMatchObject({
      title: "Mac title",
      dueAt: 123,
    });
  });

  it("waits at a missing batch instead of applying past the gap", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);
    const phone = new FakePeer(folder, "phone", WORKSPACE);

    folder.hold("phone");
    phone.put("items", { id: "i1", title: "one" });
    phone.put("items", { id: "i1", title: "two" });
    phone.put("items", { id: "i1", title: "three" });
    await phone.flush();

    folder.releaseOne("phone", 2);
    folder.releaseOne("phone", 3);

    const waiting = await engine.pull();
    expect(waiting.status).toBe("waiting");
    expect(waiting.waiting).toEqual([{ deviceId: "phone", expectedSeq: 1 }]);
    expect(await db.items.get("i1")).toBeUndefined();
    expect(await db.syncCursors.get("phone")).toBeUndefined();

    folder.releaseOne("phone", 1);
    const applied = await engine.pull();
    expect(applied.status).toBe("applied");
    expect(applied.appliedBatches).toBe(3);
    expect(await db.items.get("i1")).toMatchObject({ title: "three" });
    expect(await db.syncCursors.get("phone")).toMatchObject({ lastSeq: 3 });
  });

  it("bootstraps an empty database from a snapshot and its included cursors", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);

    const item = await createItem({ type: "task", title: "On the Mac" });
    await engine.flush();

    const phone = new FakePeer(folder, "phone", WORKSPACE);
    await phone.pull();
    phone.put("items", { id: "i2", type: "task", title: "On the phone" });
    await phone.flush();
    await phone.writeSnapshot();

    // A brand-new install: no local rows, no cursors, no history.
    await db.syncDevice.clear();
    await clearAllData();
    await enable("ipad");
    const ipad = new SyncEngine(folder);

    const result = await ipad.pull();
    expect(result.status).toBe("applied");
    expect(result.appliedSnapshots).toBe(1);
    expect(await db.items.get(item.id)).toMatchObject({ title: "On the Mac" });
    expect(await db.items.get("i2")).toMatchObject({ title: "On the phone" });
    expect(await db.syncCursors.get("mac")).toMatchObject({ lastSeq: 1 });
    expect(await db.syncCursors.get("phone")).toMatchObject({
      lastSeq: 1,
      lastSnapshotSeq: 1,
    });

    phone.put("items", { id: "i3", type: "task", title: "After the snapshot" });
    await phone.flush();
    const incremental = await ipad.pull();
    expect(incremental.appliedBatches).toBe(1);
    expect(await db.items.get("i3")).toMatchObject({ title: "After the snapshot" });
  });

  it("blocks a snapshot join when this device has independent history", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);

    const local = await createItem({ type: "task", title: "Local only" });
    await engine.flush();

    const phone = new FakePeer(folder, "phone", WORKSPACE);
    phone.put("items", { id: "remote", type: "task", title: "Remote" });
    await phone.flush();
    await phone.writeSnapshot();

    const result = await engine.pull();
    expect(result.status).toBe("blocked");
    expect(result.blocked[0]).toMatchObject({
      deviceId: "phone",
      reason: "independent-history",
    });
    expect(await db.items.get(local.id)).toMatchObject({ title: "Local only" });
    expect(await db.items.get("remote")).toBeUndefined();
    expect(await db.syncCursors.get("phone")).toBeUndefined();
  });

  it("does not advance the cursor when a remote batch is corrupt", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);
    const phone = new FakePeer(folder, "phone", WORKSPACE);

    phone.put("items", { id: "i1", type: "task", title: "first" });
    await phone.flush();
    await engine.pull();

    phone.put("items", { id: "i2", type: "task", title: "second" });
    await phone.flush();
    const good = await folder.readBatch("phone", 2);
    expect(good).not.toBeNull();
    await folder.deleteBatch("phone", 2);
    await folder.writeBatch("phone", 2, "{");

    const broken = await engine.pull();
    expect(broken.status).toBe("error");
    expect(broken.errors[0]).toMatchObject({ deviceId: "phone" });
    expect(await db.items.get("i2")).toBeUndefined();
    expect(await db.syncCursors.get("phone")).toMatchObject({ lastSeq: 1 });

    await folder.deleteBatch("phone", 2);
    await folder.writeBatch("phone", 2, good!);
    const repaired = await engine.pull();
    expect(repaired.status).toBe("applied");
    expect(await db.items.get("i2")).toMatchObject({ title: "second" });
    expect(await db.syncCursors.get("phone")).toMatchObject({ lastSeq: 2 });
  });

  it("retries an idempotent write after a crash and honors backoff", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const originalWrite = folder.writeBatch.bind(folder);
    let failAfterWrite = true;
    folder.writeBatch = async (deviceId, seq, text) => {
      await originalWrite(deviceId, seq, text);
      if (failAfterWrite) {
        failAfterWrite = false;
        throw new Error("process died after the file was written");
      }
    };

    let now = 1_000;
    const engine = new SyncEngine(folder, { now: () => now });
    await createItem({ type: "task", title: "Durable" });
    await createItem({ type: "task", title: "Later" });

    const failed = await engine.flush();
    expect(failed.status).toBe("error");
    expect(failed.written).toBe(0);
    expect(failed.pending).toBe(2);
    expect(failed.retryAt).toBe(3_000);
    expect(await folder.listBatches("mac")).toEqual([1]);
    expect(await db.syncOutbox.get(1)).toMatchObject({
      state: "error",
      attempts: 1,
      nextAttemptAt: 3_000,
    });

    const backoff = await engine.flush();
    expect(backoff.status).toBe("backoff");
    expect(backoff.written).toBe(0);
    expect(await folder.listBatches("mac")).toEqual([1]);

    now = 3_000;
    const retried = await engine.flush();
    expect(retried.status).toBe("written");
    expect(retried.written).toBe(2);
    expect(retried.pending).toBe(0);
    expect(await folder.listBatches("mac")).toEqual([1, 2]);

    const phone = new FakePeer(folder, "phone", WORKSPACE);
    await phone.pull();
    expect(
      (await db.items.toArray()).map((item) => item.title).sort(),
    ).toEqual(["Durable", "Later"]);
  });

  it("does not touch the folder while paused, but keeps journaling locally", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);
    await db.syncDevice.update("local", { paused: true });

    const item = await createItem({ type: "task", title: "Paused local edit" });
    const flush = await engine.flush();
    const pull = await engine.pull();

    expect(flush).toMatchObject({ status: "disabled", written: 0, pending: 1 });
    expect(pull.status).toBe("disabled");
    expect(await folder.listBatches("mac")).toEqual([]);
    expect(await db.syncState.get(`items:${item.id}`)).toMatchObject({ rev: 1 });

    await db.syncDevice.update("local", { paused: false });
    const resumed = await engine.flush();
    expect(resumed.status).toBe("written");
    expect(await folder.listBatches("mac")).toEqual([1]);
  });

  it("repairs a dangling reference after a remote tombstone", async () => {
    await enable();
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const engine = new SyncEngine(folder);
    const phone = new FakePeer(folder, "phone", WORKSPACE);

    phone.transact((tx) => {
      tx.put("projects", { id: "p1", name: "Work", color: "#000000", order: 0 });
      tx.put("items", {
        id: "i1",
        type: "task",
        title: "Task",
        projectId: "p1",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await phone.flush();
    await engine.pull();
    expect(await db.items.get("i1")).toMatchObject({ projectId: "p1" });

    phone.del("projects", "p1");
    await phone.flush();

    const result = await engine.pull();
    expect(result.repairs).toBeGreaterThan(0);
    expect(await db.projects.get("p1")).toBeUndefined();
    expect(await db.items.get("i1")).toMatchObject({ projectId: null });
    expect(await db.syncState.get("items:i1")).toMatchObject({
      rev: 1,
      writer: "phone",
      deleted: false,
    });
  });
});
