import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearAllData,
  createItem,
  db,
  deleteProject,
  deleteTag,
  ensureTag,
  restoreSchedule,
  updateTag,
  syncedTransaction,
  SyncWriteError,
  updateItem,
} from "./db";
import { restoreBackup, type Backup } from "../lib/backup";
import { applyImport, type ImportPlan } from "../lib/icsImport";
import { SyncWriteGuardError } from "../lib/sync/writeGuard";
import type { Item, Schedule, ScheduleBreak, ScheduleItem } from "../types";

const emptyBackup: Backup = {
  app: "tempo",
  version: 6,
  items: [],
  projects: [],
  tags: [],
  focusSessions: [],
  goals: [],
  schedules: [],
  scheduleItems: [],
  scheduleBreaks: [],
  scheduleExceptions: [],
  workProjects: [],
  members: [],
  taskDependencies: [],
  habits: [],
  habitCheckins: [],
};

async function enableSync(): Promise<void> {
  await db.syncDevice.put({
    key: "local",
    deviceId: "mac",
    installId: "install-mac",
    workspaceId: "ws_test",
    deviceName: "Mac",
    lastSeq: 0,
    lastSnapshotSeq: 0,
    enabled: true,
    folderKind: "folder",
    folderLabel: null,
  });
}

describe("syncedTransaction", () => {
  beforeAll(async () => {
    await db.open();
  });

  beforeEach(async () => {
    // syncDevice is outside the guarded domain tables, so it can be removed
    // before the normal reset path runs.
    await db.syncDevice.clear();
    await clearAllData();
  });

  it("writes the domain row, revision and one outbox batch atomically", async () => {
    await enableSync();
    const item = await createItem({ type: "task", title: "First" });

    const state = await db.syncState.get(`items:${item.id}`);
    expect(state).toMatchObject({
      table: "items",
      id: item.id,
      rev: 1,
      writer: "mac",
      deleted: false,
    });
    let outbox = await db.syncOutbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ seq: 1, state: "pending" });
    expect(outbox[0].batch.ops).toHaveLength(1);
    expect(outbox[0].batch.ops[0]).toMatchObject({
      table: "items",
      id: item.id,
      kind: "put",
      rev: 1,
      writer: "mac",
    });
    expect((await db.syncDevice.get("local"))?.lastSeq).toBe(1);

    await updateItem(item.id, { title: "Second" });
    expect(await db.syncState.get(`items:${item.id}`)).toMatchObject({ rev: 2 });
    outbox = await db.syncOutbox.toArray();
    expect(outbox.map((row) => row.seq)).toEqual([1, 2]);
    expect(outbox[1].batch.ops[0].row).toMatchObject({ title: "Second" });
    expect((await db.syncDevice.get("local"))?.lastSeq).toBe(2);

    await syncedTransaction([db.items], async (tx) => {
      await tx.del("items", item.id);
    });
    expect(await db.items.get(item.id)).toBeUndefined();
    expect(await db.syncState.get(`items:${item.id}`)).toMatchObject({
      rev: 3,
      deleted: true,
    });
    expect((await db.syncOutbox.toArray()).map((row) => row.seq)).toEqual([1, 2, 3]);
  });

  it("renames and recolours a tag without touching its items", async () => {
    const tag = await ensureTag("exam");
    const item = await createItem({ type: "task", title: "Study", tagIds: [tag.id] });

    await updateTag(tag.id, { name: "midterm", color: "#123456" });
    expect(await db.tags.get(tag.id)).toMatchObject({
      id: tag.id,
      name: "midterm",
      color: "#123456",
    });
    expect(await db.items.get(item.id)).toMatchObject({ id: item.id, tagIds: [tag.id] });
  });

  it("deletes a tag and its memberships but keeps the items", async () => {
    const tag = await ensureTag("exam");
    const item = await createItem({ type: "task", title: "Study", tagIds: [tag.id] });

    await deleteTag(tag.id);
    expect(await db.tags.get(tag.id)).toBeUndefined();
    expect(await db.items.get(item.id)).toMatchObject({
      id: item.id,
      title: "Study",
      tagIds: [],
    });
  });

  it("puts multiple operations in one batch with increasing revisions", async () => {
    await enableSync();
    await syncedTransaction([db.projects, db.items], async (tx) => {
      await tx.put("projects", { id: "p1", name: "Work", color: "#000000", order: 0 });
      await tx.put("items", { id: "i1", type: "task", title: "A", createdAt: 1, updatedAt: 1 });
    });

    const outbox = await db.syncOutbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].seq).toBe(1);
    expect(outbox[0].batch.ops).toHaveLength(2);
    expect(await db.syncState.get("projects:p1")).toMatchObject({ rev: 1 });
    expect(await db.syncState.get("items:i1")).toMatchObject({ rev: 1 });
    expect((await db.syncDevice.get("local"))?.lastSeq).toBe(1);
  });

  it("splits a bulk transaction into ordered batches without splitting the commit", async () => {
    await enableSync();
    await syncedTransaction(
      [db.items],
      async (tx) => {
        for (let index = 0; index < 2_001; index += 1) {
          await tx.put("items", {
            id: `i${index}`,
            type: "task",
            title: `Task ${index}`,
            createdAt: 1,
            updatedAt: 1,
          });
        }
      },
      { allowSplit: true },
    );

    const outbox = await db.syncOutbox.toArray();
    expect(outbox.map((row) => row.seq)).toEqual([1, 2]);
    expect(outbox.map((row) => row.batch.ops.length)).toEqual([2_000, 1]);
    expect(await db.items.count()).toBe(2_001);
    expect(await db.syncState.count()).toBe(2_001);
    expect((await db.syncDevice.get("local"))?.lastSeq).toBe(2);
  }, 20_000);

  it("writes locally without journaling when sync is disabled", async () => {
    const item = await createItem({ type: "task", title: "Local only" });
    expect(await db.items.get(item.id)).toMatchObject({ title: "Local only" });
    expect(await db.syncState.count()).toBe(0);
    expect(await db.syncOutbox.count()).toBe(0);
  });

  it("rolls back the domain row and journal entry when the callback fails", async () => {
    await enableSync();
    await expect(
      syncedTransaction([db.items], async (tx) => {
        await tx.put("items", {
          id: "i1",
          type: "task",
          title: "Doomed",
          createdAt: 1,
          updatedAt: 1,
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await db.items.get("i1")).toBeUndefined();
    expect(await db.syncState.get("items:i1")).toBeUndefined();
    expect(await db.syncOutbox.count()).toBe(0);
    expect((await db.syncDevice.get("local"))?.lastSeq).toBe(0);
  });

  it("rejects a direct domain write outside the helper", async () => {
    await expect(
      db.items.put({ id: "i1", type: "task", title: "Nope", createdAt: 1, updatedAt: 1 }),
    ).rejects.toThrow(SyncWriteGuardError);
    await expect(db.items.delete("i1")).rejects.toThrow(SyncWriteGuardError);
    expect(await db.items.get("i1")).toBeUndefined();
  });

  it("rejects a direct write even inside the transaction callback", async () => {
    await expect(
      syncedTransaction([db.items], async () => {
        await db.items.put({ id: "i1", type: "task", title: "Nope", createdAt: 1, updatedAt: 1 });
      }),
    ).rejects.toThrow(SyncWriteGuardError);
    expect(await db.items.get("i1")).toBeUndefined();
  });

  it("journals an ICS import as one batch with its tags", async () => {
    await enableSync();
    const item: Item = {
      id: "i1",
      type: "event",
      title: "Lecture",
      createdAt: 1,
      updatedAt: 1,
    };
    const plan: ImportPlan = {
      calendarName: "Imported",
      rows: [{ item, categories: ["exam"] }],
      counts: { events: 1, tasks: 0, recurring: 0, duplicates: 0, skipped: 0 },
      earliest: null,
      latest: null,
    };

    const result = await applyImport(plan, []);

    expect(result.tagNames).toEqual(["exam"]);
    const outbox = await db.syncOutbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].batch.ops.map((op) => op.table)).toEqual(["tags", "items"]);
    expect(await db.items.get("i1")).toMatchObject({ title: "Lecture" });
  });

  it("journals a schedule undo as one batch", async () => {
    await enableSync();
    const schedule: Schedule = {
      id: "s1",
      name: "Term",
      color: "#000000",
      order: 0,
      from: 1,
      to: 2,
      createdAt: 1,
      updatedAt: 1,
    };
    const item: ScheduleItem = {
      id: "si1",
      scheduleId: "s1",
      name: "Class",
      days: [1],
      startMin: 540,
      endMin: 600,
      order: 0,
    };
    const brk: ScheduleBreak = {
      id: "sb1",
      scheduleId: "s1",
      label: "Break",
      from: 1,
      to: 2,
    };

    await restoreSchedule(schedule, [item], [brk]);

    const outbox = await db.syncOutbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].batch.ops).toHaveLength(3);
    expect(new Set(outbox[0].batch.ops.map((op) => op.table))).toEqual(
      new Set(["schedules", "scheduleItems", "scheduleBreaks"]),
    );
  });

  it("journals a project delete and its item repairs in one batch", async () => {
    await enableSync();
    await syncedTransaction(
      [db.projects, db.items, db.goals, db.workProjects],
      async (tx) => {
        await tx.put("projects", { id: "p1", name: "Work", color: "#000000", order: 0 });
        await tx.put("items", {
          id: "i1",
          type: "task",
          title: "Task",
          projectId: "p1",
          createdAt: 1,
          updatedAt: 1,
        });
        await tx.put("goals", {
          id: "g1",
          title: "Goal",
          span: "open",
          start: 1,
          projectId: "p1",
          createdAt: 1,
          updatedAt: 1,
        });
        await tx.put("workProjects", {
          id: "wp1",
          name: "Plan",
          color: "#000000",
          calendarId: "p1",
          start: 1,
          workingDays: [1, 2, 3, 4, 5],
          memberIds: [],
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        });
      },
    );

    await deleteProject("p1");

    expect(await db.projects.get("p1")).toBeUndefined();
    expect(await db.items.get("i1")).toMatchObject({ projectId: null });
    expect(await db.goals.get("g1")).toMatchObject({ projectId: null });
    expect(await db.workProjects.get("wp1")).toMatchObject({ calendarId: null });
    const outbox = await db.syncOutbox.toArray();
    expect(outbox).toHaveLength(2);
    expect(outbox[1].batch.ops).toHaveLength(4);
    expect(outbox[1].batch.ops.map((op) => op.kind)).toEqual(["put", "put", "put", "del"]);
  });
});

describe("whole-workspace operations", () => {
  beforeAll(async () => {
    await db.open();
  });

  beforeEach(async () => {
    await db.syncDevice.clear();
    await clearAllData();
  });

  it("refuses a restore while sync is enabled", async () => {
    await enableSync();
    await expect(restoreBackup(emptyBackup, "merge")).rejects.toThrow(SyncWriteError);
    await expect(clearAllData()).rejects.toThrow(SyncWriteError);
  });

  it("clears journal rows and sets resetPending after a restore", async () => {
    await db.syncDevice.put({
      key: "local",
      deviceId: "mac",
      installId: "install-mac",
      workspaceId: "ws_test",
      deviceName: "Mac",
      lastSeq: 4,
      lastSnapshotSeq: 0,
      enabled: false,
      folderKind: "folder",
      folderLabel: null,
    });
    await db.syncState.put({
      key: "items:i1",
      table: "items",
      id: "i1",
      rev: 2,
      writer: "mac",
      deleted: false,
      at: 1,
    });

    await restoreBackup(emptyBackup, "replace");

    expect(await db.syncDevice.get("local")).toBeUndefined();
    expect(await db.syncState.count()).toBe(0);
    expect((await db.settings.get("sync.resetPending"))?.value).toBe(true);
  });
});
