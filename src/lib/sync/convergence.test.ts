import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BATCH_RETENTION_MS } from "./compaction";
import { DiskSyncFolder } from "./diskFolder";
import { FakeSyncFolder } from "./fakeFolder";
import { FakePeer, type FakePeerDump } from "./fakePeer";
import { SyncFormatError, type MergeState } from "./merge";

const WORKSPACE = "ws_test";
const roots: string[] = [];

async function setup() {
  const folder = new FakeSyncFolder();
  await folder.createWorkspace(WORKSPACE, "mac");
  return {
    folder,
    mac: new FakePeer(folder, "mac", WORKSPACE),
    phone: new FakePeer(folder, "phone", WORKSPACE),
  };
}

function stateOf(peer: FakePeer): Array<[string, unknown]> {
  return [...(peer.state as MergeState).entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function diskSetup() {
  const root = await mkdtemp(join(tmpdir(), "tempo-converge-"));
  roots.push(root);
  const admin = new DiskSyncFolder(root);
  await admin.createWorkspace(WORKSPACE, "mac");
  return {
    root,
    admin,
    mac: new FakePeer(new DiskSyncFolder(root, { localDeviceId: "mac" }), "mac", WORKSPACE),
    phone: new FakePeer(new DiskSyncFolder(root, { localDeviceId: "phone" }), "phone", WORKSPACE),
  };
}

function reopen(root: string, peer: FakePeer): FakePeer {
  const dump = JSON.parse(JSON.stringify(peer.dump())) as FakePeerDump;
  return FakePeer.restore(
    new DiskSyncFolder(root, { localDeviceId: peer.deviceId }),
    peer.deviceId,
    peer.workspaceId,
    dump,
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("fake-file convergence", () => {
  it("converges after concurrent edits using the writer tie-break", async () => {
    const { mac, phone } = await setup();
    mac.put("items", { id: "i1", type: "task", title: "base" });
    await mac.flush();
    await phone.pull();
    expect(phone.get("items", "i1")?.title).toBe("base");

    mac.put("items", { id: "i1", type: "task", title: "mac edit" });
    phone.put("items", { id: "i1", type: "task", title: "phone edit" });
    await mac.flush();
    await phone.flush();

    await mac.pull();
    await phone.pull();

    expect(mac.get("items", "i1")?.title).toBe("phone edit");
    expect(phone.get("items", "i1")?.title).toBe("phone edit");
    expect(stateOf(mac)).toEqual(stateOf(phone));
    expect(mac.conflicts).toHaveLength(1);
    expect(mac.conflicts[0]).toMatchObject({
      table: "items",
      rowId: "i1",
      winner: "remote",
      lostRow: { title: "mac edit" },
    });
    expect(phone.conflicts).toHaveLength(0);
  });

  it("waits for a missing batch instead of applying past the gap", async () => {
    const { folder, mac, phone } = await setup();
    folder.hold("mac");
    mac.put("items", { id: "i1", title: "one" });
    mac.put("items", { id: "i1", title: "two" });
    mac.put("items", { id: "i1", title: "three" });
    await mac.flush();
    expect(folder.heldBatches("mac")).toEqual([1, 2, 3]);

    folder.releaseOne("mac", 2);
    folder.releaseOne("mac", 3);
    await phone.pull();
    expect(phone.get("items", "i1")).toBeNull();
    expect(phone.cursors.get("mac")).toBeUndefined();

    folder.releaseOne("mac", 1);
    await phone.pull();
    expect(phone.get("items", "i1")?.title).toBe("three");
    expect(phone.cursors.get("mac")).toBe(3);
  });

  it("bootstraps a fresh device from a snapshot that covers a compacted peer batch", async () => {
    const { folder, mac, phone } = await setup();
    mac.put("items", { id: "i1", title: "A" });
    await mac.flush();
    await phone.pull();

    phone.put("items", { id: "i1", title: "B" });
    await phone.flush();
    await mac.pull();
    expect(mac.get("items", "i1")?.title).toBe("B");

    await mac.writeSnapshot();
    phone.put("items", { id: "i2", title: "C" });
    await phone.flush();

    // Compact only the phone's first batch. The Mac's batch 1 is still
    // present, so a fresh reader must take the snapshot first or it will miss
    // the phone's row entirely.
    await folder.deleteBatch("phone", 1);

    const ipad = new FakePeer(folder, "ipad", WORKSPACE);
    await ipad.pull();
    expect(ipad.get("items", "i1")?.title).toBe("B");
    expect(ipad.get("items", "i2")?.title).toBe("C");
    // The snapshot's included map advances the phone cursor to 1 before the
    // remaining phone batch 2 is read.
    expect(ipad.cursors.get("mac")).toBe(1);
    expect(ipad.cursors.get("phone")).toBe(2);

    await mac.pull();
    await phone.pull();
    expect(stateOf(ipad)).toEqual(stateOf(mac));
    expect(stateOf(ipad)).toEqual(stateOf(phone));
  });

  it("repairs a project reference after a delete/edit conflict", async () => {
    const { mac, phone } = await setup();
    mac.put("projects", { id: "p1", name: "Work", color: "#000", order: 0 });
    mac.put("items", { id: "i1", type: "task", title: "Task", projectId: "p1" });
    await mac.flush();
    await phone.pull();

    const item = mac.get("items", "i1");
    expect(item).not.toBeNull();
    mac.transact((tx) => {
      tx.put("items", { ...item!, projectId: null });
      tx.del("projects", "p1");
    });
    phone.put("items", { ...item!, title: "Phone edit" });

    await mac.flush();
    await phone.flush();
    await mac.pull();
    await phone.pull();

    expect(mac.get("projects", "p1")).toBeNull();
    expect(phone.get("projects", "p1")).toBeNull();
    expect(mac.get("items", "i1")).toMatchObject({
      title: "Phone edit",
      projectId: null,
    });
    expect(phone.get("items", "i1")).toMatchObject({
      title: "Phone edit",
      projectId: null,
    });
    expect(stateOf(mac)).toEqual(stateOf(phone));
  });

  it("replays an already-applied batch without changing state", async () => {
    const { mac, phone } = await setup();
    mac.put("items", { id: "i1", title: "once" });
    await mac.flush();
    await phone.pull();
    const before = stateOf(phone);

    phone.cursors.set("mac", 0);
    await phone.pull();

    expect(stateOf(phone)).toEqual(before);
    expect(phone.conflicts).toHaveLength(0);
  });

  it("refuses a corrupt batch without moving the cursor", async () => {
    const { folder, mac, phone } = await setup();
    mac.put("items", { id: "i1", title: "first" });
    await mac.flush();
    await phone.pull();

    mac.put("items", { id: "i2", title: "second" });
    await mac.flush();
    const good = await folder.readBatch("mac", 2);
    expect(good).not.toBeNull();

    const corrupt = JSON.parse(good!) as { ops: Array<Record<string, unknown>> };
    corrupt.ops = [{ ...corrupt.ops[0], table: "not_a_table" }];
    await folder.deleteBatch("mac", 2);
    await folder.writeBatch("mac", 2, JSON.stringify(corrupt));

    await expect(phone.pull()).rejects.toThrow(SyncFormatError);
    expect(phone.get("items", "i2")).toBeNull();
    expect(phone.cursors.get("mac")).toBe(1);

    await folder.deleteBatch("mac", 2);
    await folder.writeBatch("mac", 2, good!);
    await phone.pull();
    expect(phone.get("items", "i2")?.title).toBe("second");
    expect(phone.cursors.get("mac")).toBe(2);
  });

  it("refuses a folder for another workspace", async () => {
    const folder = new FakeSyncFolder();
    await folder.createWorkspace("some_other_workspace", "mac");
    const phone = new FakePeer(folder, "phone", WORKSPACE);
    await expect(phone.pull()).rejects.toThrow(/another workspace/);
  });

  it("refuses a snapshot with a newer format version", async () => {
    const folder = new FakeSyncFolder();
    await folder.createWorkspace(WORKSPACE, "mac");
    const phone = new FakePeer(folder, "phone", WORKSPACE);
    await folder.writeSnapshot(
      "mac",
      0,
      JSON.stringify({
        format: "tempo-sync-snapshot",
        version: 2,
        workspaceId: WORKSPACE,
        deviceId: "mac",
        seq: 0,
        createdAt: 1,
        dataVersion: 5,
        included: { mac: 0 },
        rows: [],
        tombstones: [],
      }),
    );

    await expect(phone.pull()).rejects.toThrow(SyncFormatError);
    expect(phone.state.size).toBe(0);
  });
});

describe("durable fake-file convergence", () => {
  it("converges over real files with restarts on both devices", async () => {
    const { root, admin, mac, phone } = await diskSetup();

    mac.put("items", { id: "i1", type: "task", title: "base" });
    await mac.flush();
    await phone.pull();

    const restartedMac = reopen(root, mac);
    restartedMac.put("items", { id: "i1", type: "task", title: "mac edit" });
    phone.put("items", { id: "i1", type: "task", title: "phone edit" });
    await restartedMac.flush();
    await phone.flush();

    const restartedPhone = reopen(root, phone);
    await restartedMac.pull();
    await restartedPhone.pull();

    expect(restartedMac.get("items", "i1")?.title).toBe("phone edit");
    expect(restartedPhone.get("items", "i1")?.title).toBe("phone edit");
    expect(stateOf(restartedMac)).toEqual(stateOf(restartedPhone));
    expect(await admin.listBatches("mac")).toEqual([1, 2]);
    expect(await admin.readMeta("mac")).toContain("tempo-sync-device");
  });

  it("keeps an unflushed commit in the outbox across a restart", async () => {
    const { root, admin, mac, phone } = await diskSetup();

    mac.put("items", { id: "i1", type: "task", title: "draft" });
    expect(await admin.listBatches("mac")).toEqual([]);

    const restarted = reopen(root, mac);
    expect(restarted.get("items", "i1")?.title).toBe("draft");
    expect(restarted.outbox).toHaveLength(1);

    await restarted.flush();
    await phone.pull();
    expect(phone.get("items", "i1")?.title).toBe("draft");
    expect(phone.cursors.get("mac")).toBe(1);
  });

  it("retries a batch written before a crash removed the outbox row", async () => {
    const { root, admin, phone } = await diskSetup();
    const crashing = new FakePeer(
      new DiskSyncFolder(root, { localDeviceId: "mac" }),
      "mac",
      WORKSPACE,
      {
        afterBatchWrite: () => {
          throw new Error("crash after write");
        },
      },
    );

    crashing.put("items", { id: "i1", type: "task", title: "survives" });
    await expect(crashing.flush()).rejects.toThrow("crash after write");
    expect(crashing.outbox).toHaveLength(1);
    expect(await admin.listBatches("mac")).toEqual([1]);

    const restarted = reopen(root, crashing);
    await restarted.flush();
    expect(await admin.listBatches("mac")).toEqual([1]);
    expect(await admin.readBatch("mac", 1)).toContain("survives");

    await phone.pull();
    expect(phone.get("items", "i1")?.title).toBe("survives");
    expect(phone.cursors.get("mac")).toBe(1);
  });

  it("replays a pull transaction after a crash without duplicating conflicts", async () => {
    const { root, mac, phone } = await diskSetup();
    mac.put("items", { id: "i1", type: "task", title: "remote" });
    await mac.flush();

    const before = phone.dump();
    await phone.pull();
    const after = phone.dump();

    // A crash before the apply transaction commits loses both the row and the
    // cursor. The retry starts from the previous dump.
    const replayed = FakePeer.restore(
      new DiskSyncFolder(root, { localDeviceId: "phone" }),
      "phone",
      WORKSPACE,
      JSON.parse(JSON.stringify(before)) as FakePeerDump,
    );
    await replayed.pull();

    expect(stateOf(replayed)).toEqual(stateOf(phone));
    expect(replayed.cursors).toEqual(phone.cursors);
    expect(replayed.conflicts).toHaveLength(0);
    expect(after.conflicts).toHaveLength(0);
  });

  it("converges concurrent project and schedule cascades with tombstones", async () => {
    const { mac, phone } = await diskSetup();
    mac.transact((tx) => {
      tx.put("projects", { id: "p1", name: "Work", color: "#000000", order: 0 });
      tx.put("tags", { id: "t1", name: "exam" });
      tx.put("items", {
        id: "i1",
        type: "task",
        title: "Task",
        projectId: "p1",
        tagIds: ["t1"],
        createdAt: 1,
        updatedAt: 1,
      });
      tx.put("schedules", {
        id: "s1",
        name: "Term",
        color: "#000000",
        order: 0,
        from: 1,
        to: 2,
        createdAt: 1,
        updatedAt: 1,
      });
      tx.put("scheduleItems", {
        id: "si1",
        scheduleId: "s1",
        name: "Class",
        days: [1],
        startMin: 540,
        endMin: 600,
        order: 0,
      });
    });
    await mac.flush();
    await phone.pull();

    const item = mac.get("items", "i1");
    expect(item).not.toBeNull();

    mac.transact((tx) => {
      tx.put("items", { ...item!, projectId: null, tagIds: [] });
      tx.del("projects", "p1");
      tx.del("tags", "t1");
      tx.del("scheduleItems", "si1");
      tx.del("schedules", "s1");
    });
    phone.transact((tx) => {
      tx.put("items", { ...item!, title: "Phone edit" });
      tx.put("scheduleItems", {
        id: "si1",
        scheduleId: "s1",
        name: "Phone session",
        days: [1],
        startMin: 540,
        endMin: 600,
        order: 1,
      });
    });

    await mac.flush();
    await phone.flush();
    await mac.pull();
    await phone.pull();

    for (const peer of [mac, phone]) {
      expect(peer.get("projects", "p1")).toBeNull();
      expect(peer.get("tags", "t1")).toBeNull();
      expect(peer.get("schedules", "s1")).toBeNull();
      expect(peer.get("scheduleItems", "si1")).toBeNull();
      expect(peer.get("items", "i1")).toMatchObject({
        title: "Phone edit",
        projectId: null,
        tagIds: [],
      });
    }
    expect(stateOf(mac)).toEqual(stateOf(phone));
  });

  it("keeps tombstones through compaction so a deleted row cannot return", async () => {
    const { mac, phone } = await diskSetup();
    mac.put("items", { id: "i1", type: "task", title: "keep" });
    mac.put("items", { id: "i2", type: "task", title: "remove" });
    await mac.flush();
    await phone.pull();
    expect(phone.get("items", "i2")?.title).toBe("remove");

    mac.del("items", "i2");
    await mac.flush();
    await mac.compact(1_000_000_000_000 + BATCH_RETENTION_MS);
    expect(await mac.folder.listBatches("mac")).toEqual([]);

    await phone.pull();
    expect(phone.get("items", "i1")?.title).toBe("keep");
    expect(phone.get("items", "i2")).toBeNull();
    expect(phone.state.get("items:i2")).toMatchObject({ deleted: true });
  });
});
