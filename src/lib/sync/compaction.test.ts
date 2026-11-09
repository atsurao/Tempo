import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessPeerHistory,
  BATCH_RETENTION_MS,
  planCompaction,
  SNAPSHOT_EVERY_BATCHES,
  SNAPSHOT_EVERY_MS,
  SOFT_BATCH_FILE_TARGET,
} from "./compaction";
import { DiskSyncFolder } from "./diskFolder";
import { FakePeer } from "./fakePeer";
import { parseSnapshot } from "./merge";

const WORKSPACE = "ws_compact";
const DAY = 24 * 60 * 60 * 1000;
const START = 1_700_000_000_000;

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tempo-compact-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function files(seqs: number[], createdAt: number): Array<{ seq: number; createdAt: number }> {
  return seqs.map((seq) => ({ seq, createdAt }));
}

describe("planCompaction", () => {
  it("snapshots at 500 batches, not before", () => {
    const now = START + DAY;
    const before = planCompaction({
      lastSeq: SNAPSHOT_EVERY_BATCHES - 1,
      outboxCount: 0,
      batches: files(
        Array.from({ length: SNAPSHOT_EVERY_BATCHES - 1 }, (_, index) => index + 1),
        now,
      ),
      snapshots: [],
      now,
    });
    expect(before.writeSnapshot).toBe(false);
    expect(before.snapshotReason).toBeNull();

    const at = planCompaction({
      lastSeq: SNAPSHOT_EVERY_BATCHES,
      outboxCount: 0,
      batches: files(
        Array.from({ length: SNAPSHOT_EVERY_BATCHES }, (_, index) => index + 1),
        now,
      ),
      snapshots: [],
      now,
    });
    expect(at.writeSnapshot).toBe(true);
    expect(at.snapshotReason).toBe("batch-count");
  });

  it("snapshots after seven days only when there are new local batches", () => {
    const stale = planCompaction({
      lastSeq: 1,
      outboxCount: 0,
      batches: files([1], START - SNAPSHOT_EVERY_MS - 1),
      snapshots: [],
      now: START,
    });
    expect(stale.snapshotReason).toBe("age");

    const current = planCompaction({
      lastSeq: 1,
      outboxCount: 0,
      batches: [],
      snapshots: files([1], START - SNAPSHOT_EVERY_MS - 1),
      now: START,
    });
    expect(current.writeSnapshot).toBe(false);
  });

  it("deletes only batches that a snapshot covers and that are 30 days old", () => {
    const now = START;
    const plan = planCompaction({
      lastSeq: 3,
      outboxCount: 0,
      batches: [
        { seq: 1, createdAt: now - BATCH_RETENTION_MS - 1 },
        { seq: 2, createdAt: now - BATCH_RETENTION_MS + 1 },
        { seq: 3, createdAt: now - BATCH_RETENTION_MS - 1 },
      ],
      snapshots: files([2], now),
      now,
    });
    expect(plan.writeSnapshot).toBe(false);
    expect(plan.snapshotCoveredSeq).toBe(2);
    expect(plan.deleteBatches).toEqual([1]);
    expect(plan.fileCount).toBe(2);
  });

  it("keeps the latest three snapshots", () => {
    const plan = planCompaction({
      lastSeq: 4,
      outboxCount: 0,
      batches: [],
      snapshots: files([1, 2, 3, 4], START),
      now: START + DAY,
    });
    expect(plan.deleteSnapshots).toEqual([1]);
  });

  it("pauses snapping and pruning while the outbox has work", () => {
    const plan = planCompaction({
      lastSeq: 600,
      outboxCount: 1,
      batches: files(
        Array.from({ length: 600 }, (_, index) => index + 1),
        START - BATCH_RETENTION_MS - 1,
      ),
      snapshots: files([1, 2, 3, 4], START - BATCH_RETENTION_MS),
      now: START,
    });
    expect(plan.writeSnapshot).toBe(false);
    expect(plan.deleteBatches).toEqual([]);
    expect(plan.deleteSnapshots).toEqual([]);
  });

  it("warns above the file target instead of deleting unsafe batches", () => {
    const plan = planCompaction({
      lastSeq: SOFT_BATCH_FILE_TARGET + 1,
      outboxCount: 0,
      batches: files(
        Array.from({ length: SOFT_BATCH_FILE_TARGET + 1 }, (_, index) => index + 1),
        START,
      ),
      snapshots: [],
      now: START + DAY,
    });
    expect(plan.snapshotReason).toBe("file-pressure");
    expect(plan.fileCount).toBe(SOFT_BATCH_FILE_TARGET + 1);
    expect(plan.warning).toContain("2,000-file target");
    // One day old: young batches are never removed even under file pressure.
    expect(plan.deleteBatches).toEqual([]);
  });
});

describe("assessPeerHistory", () => {
  it("takes a snapshot for a fresh reader before any remaining batches", () => {
    expect(assessPeerHistory(0, [1], [5]).mode).toBe("snapshot");
    expect(assessPeerHistory(0, [], [0]).mode).toBe("snapshot");
  });

  it("reads contiguous batches incrementally", () => {
    expect(assessPeerHistory(2, [2, 3, 4], [5])).toMatchObject({
      mode: "incremental",
      snapshotSeq: 5,
    });
  });

  it("bootstraps when the next batch was compacted and a newer snapshot exists", () => {
    expect(assessPeerHistory(2, [5, 6], [3, 4])).toMatchObject({
      mode: "snapshot",
      snapshotSeq: 4,
    });
    expect(assessPeerHistory(5, [], [5]).mode).toBe("current");
  });

  it("reports a gap rather than skipping it", () => {
    expect(assessPeerHistory(2, [5], []).mode).toBe("gap");
    expect(assessPeerHistory(0, [5], []).mode).toBe("gap");
  });
});

describe("fake peer compaction", () => {
  async function setup(clock = START) {
    const root = await tempRoot();
    const admin = new DiskSyncFolder(root);
    await admin.createWorkspace(WORKSPACE, "mac");
    const mac = new FakePeer(new DiskSyncFolder(root, { localDeviceId: "mac" }), "mac", WORKSPACE, {
      clock,
    });
    return { root, admin, mac };
  }

  it("compacts 500 batches into one snapshot that a fresh device can join from", async () => {
    const { root, admin, mac } = await setup(1_000);
    for (let index = 0; index < SNAPSHOT_EVERY_BATCHES; index += 1) {
      mac.put("items", { id: `i${index}`, type: "task", title: `Task ${index}` });
    }
    await mac.flush();

    const plan = await mac.compact(START + BATCH_RETENTION_MS + 1);

    expect(plan.writeSnapshot).toBe(true);
    expect(plan.snapshotReason).toBe("batch-count");
    expect(await admin.listBatches("mac")).toEqual([]);
    expect(await admin.listSnapshots("mac")).toEqual([SNAPSHOT_EVERY_BATCHES]);

    const ipad = new FakePeer(
      new DiskSyncFolder(root, { localDeviceId: "ipad" }),
      "ipad",
      WORKSPACE,
    );
    await ipad.pull();
    expect(ipad.state.size).toBe(SNAPSHOT_EVERY_BATCHES);
    expect(ipad.get("items", "i0")?.title).toBe("Task 0");
    expect(ipad.cursors.get("mac")).toBe(SNAPSHOT_EVERY_BATCHES);
  }, 20_000);

  it("keeps young batches and prunes them once they pass 30 days", async () => {
    const { admin, mac } = await setup();
    mac.put("items", { id: "i1", type: "task", title: "One" });
    mac.put("items", { id: "i2", type: "task", title: "Two" });
    await mac.flush();

    const first = await mac.compact(START + 8 * DAY);
    expect(first.writeSnapshot).toBe(true);
    expect(first.snapshotReason).toBe("age");
    expect(first.deleteBatches).toEqual([]);
    expect(await admin.listBatches("mac")).toEqual([1, 2]);
    expect(await admin.listSnapshots("mac")).toEqual([2]);

    const second = await mac.compact(START + 31 * DAY);
    expect(second.writeSnapshot).toBe(false);
    expect(second.deleteBatches).toEqual([1, 2]);
    expect(await admin.listBatches("mac")).toEqual([]);
    expect(await admin.listSnapshots("mac")).toEqual([2]);
  });

  it("finishes pruning after a crash that wrote the snapshot but not the deletes", async () => {
    const { admin, mac } = await setup();
    mac.put("items", { id: "i1", type: "task", title: "One" });
    await mac.flush();
    await mac.writeSnapshot(START + 8 * DAY);

    const plan = await mac.compact(START + 31 * DAY);
    expect(plan.writeSnapshot).toBe(false);
    expect(plan.deleteBatches).toEqual([1]);
    expect(await admin.listBatches("mac")).toEqual([]);
    expect(await admin.listSnapshots("mac")).toEqual([1]);
  });

  it("retains the newest three snapshots and includes known peer cursors", async () => {
    const { root, admin, mac } = await setup();
    const phone = new FakePeer(
      new DiskSyncFolder(root, { localDeviceId: "phone" }),
      "phone",
      WORKSPACE,
    );

    mac.put("items", { id: "i1", type: "task", title: "Mac" });
    await mac.flush();
    await phone.pull();
    phone.put("items", { id: "i2", type: "task", title: "Phone" });
    await phone.flush();
    await mac.pull();
    await mac.writeSnapshot(START + 8 * DAY);

    const text = await admin.readSnapshot("mac", 1);
    expect(text).not.toBeNull();
    const snapshot = parseSnapshot(text!, WORKSPACE);
    expect(snapshot.included).toEqual({ mac: 1, phone: 1 });
    expect(snapshot.rows.map((row) => row.id).sort()).toEqual(["i1", "i2"]);

    mac.put("items", { id: "i3", type: "task", title: "Three" });
    await mac.flush();
    await mac.writeSnapshot(START + 9 * DAY);
    mac.put("items", { id: "i4", type: "task", title: "Four" });
    await mac.flush();
    await mac.writeSnapshot(START + 10 * DAY);
    mac.put("items", { id: "i5", type: "task", title: "Five" });
    await mac.flush();
    await mac.writeSnapshot(START + 11 * DAY);

    const plan = await mac.compact(START + 12 * DAY);
    expect(plan.deleteSnapshots).toEqual([1]);
    expect(await admin.listSnapshots("mac")).toEqual([2, 3, 4]);
  });

  it("does not wait for a peer acknowledgement before pruning", async () => {
    const { root, admin, mac } = await setup();
    const phone = new FakePeer(
      new DiskSyncFolder(root, { localDeviceId: "phone" }),
      "phone",
      WORKSPACE,
    );

    mac.put("items", { id: "i1", type: "task", title: "One" });
    await mac.flush();
    await phone.pull();
    mac.put("items", { id: "i2", type: "task", title: "Two" });
    await mac.flush();

    // Phone is still at cursor 1; 30 days later the Mac prunes both batches
    // anyway. Phone must bootstrap from the snapshot, not block cleanup.
    expect(phone.cursors.get("mac")).toBe(1);
    await mac.compact(START + 31 * DAY);
    expect(await admin.listBatches("mac")).toEqual([]);

    await phone.pull();
    expect(phone.get("items", "i1")?.title).toBe("One");
    expect(phone.get("items", "i2")?.title).toBe("Two");
    expect(phone.cursors.get("mac")).toBe(2);
  });

  it("requires a choice instead of overwriting a peer with pending local edits", async () => {
    const { root, mac } = await setup();
    const phone = new FakePeer(
      new DiskSyncFolder(root, { localDeviceId: "phone" }),
      "phone",
      WORKSPACE,
    );

    mac.put("items", { id: "i1", type: "task", title: "Remote" });
    await mac.flush();
    await phone.pull();

    phone.put("items", { id: "local", type: "task", title: "Local draft" });
    mac.put("items", { id: "i2", type: "task", title: "Remote two" });
    await mac.flush();
    await mac.compact(START + 31 * DAY);

    await expect(phone.pull()).rejects.toThrow(/replace-from-sync/);
    expect(phone.get("items", "local")?.title).toBe("Local draft");
    expect(phone.outbox).toHaveLength(1);
    expect(phone.get("items", "i2")).toBeNull();
  });
});
