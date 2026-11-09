import { describe, expect, it } from "vitest";
import {
  applyBatch,
  applyOp,
  applySnapshot,
  buildSnapshot,
  localDelete,
  localPut,
  mergeCursors,
  mergeRows,
  parseBatch,
  parseWorkspace,
  remoteWins,
  repairReferences,
  SyncFormatError,
  validateBatch,
  validateSnapshot,
  type MergeState,
} from "./merge";
import {
  SYNC_DATA_VERSION,
  SYNC_FORMAT_VERSION,
  type JournalBatch,
  type SyncOp,
  type SyncTable,
} from "./types";

const WORKSPACE = "ws_test";

function put(
  table: SyncTable,
  id: string,
  rev: number,
  writer: string,
  rest: Record<string, unknown> = {},
): SyncOp {
  return {
    table,
    id,
    kind: "put",
    rev,
    writer,
    at: rev * 10,
    row: { id, ...rest },
  };
}

function del(table: SyncTable, id: string, rev: number, writer: string): SyncOp {
  return { table, id, kind: "del", rev, writer, at: rev * 10 };
}

function batch(deviceId: string, seq: number, ops: SyncOp[]): JournalBatch {
  return {
    format: "tempo-sync-batch",
    version: SYNC_FORMAT_VERSION,
    workspaceId: WORKSPACE,
    deviceId,
    seq,
    createdAt: seq * 10,
    dataVersion: SYNC_DATA_VERSION,
    ops,
  };
}

function stateWith(...ops: SyncOp[]): MergeState {
  let state: MergeState = new Map();
  for (const op of ops) state = applyOp(state, op).state;
  return state;
}

describe("remoteWins", () => {
  it("accepts a row with no local revision", () => {
    expect(remoteWins({ rev: 1, writer: "mac" }, undefined)).toBe(true);
  });

  it("uses the higher Lamport revision before the writer id", () => {
    expect(remoteWins({ rev: 3, writer: "aaa" }, { rev: 2, writer: "zzz" })).toBe(true);
    expect(remoteWins({ rev: 2, writer: "zzz" }, { rev: 3, writer: "aaa" })).toBe(false);
  });

  it("breaks an equal revision tie by writer id, deterministically", () => {
    expect(remoteWins({ rev: 2, writer: "phone" }, { rev: 2, writer: "mac" })).toBe(true);
    expect(remoteWins({ rev: 2, writer: "mac" }, { rev: 2, writer: "phone" })).toBe(false);
  });

  it("treats the same revision and writer as a duplicate", () => {
    expect(remoteWins({ rev: 2, writer: "mac" }, { rev: 2, writer: "mac" })).toBe(false);
  });

  it("prefers a causally later edit even when its revision is lower", () => {
    const local = { rev: 5, writer: "mac", clock: { mac: 5 } };
    const remote = { rev: 3, writer: "phone", clock: { mac: 5, phone: 1 } };
    expect(remoteWins(remote, local)).toBe(true);
    expect(remoteWins(local, remote)).toBe(false);
  });

  it("keeps independent edits concurrent for the revision fallback", () => {
    const mac = { rev: 2, writer: "mac", clock: { mac: 2 } };
    const phone = { rev: 2, writer: "phone", clock: { phone: 2 } };
    expect(remoteWins(phone, mac)).toBe(true);
    expect(remoteWins(mac, phone)).toBe(false);
  });
});

describe("applying operations", () => {
  it("does not let a stale put resurrect a tombstone", () => {
    const deleted = stateWith(put("items", "i1", 1, "mac"), del("items", "i1", 2, "mac"));
    const result = applyOp(deleted, put("items", "i1", 1, "phone", { title: "old" }));
    expect(result.status).toBe("ignored");
    expect(result.state.get("items:i1")).toMatchObject({ deleted: true, row: null });
  });

  it("lets a higher revision resurrect a tombstone", () => {
    const deleted = stateWith(del("items", "i1", 2, "mac"));
    const result = applyOp(deleted, put("items", "i1", 3, "phone", { title: "back" }));
    expect(result.status).toBe("applied");
    expect(result.state.get("items:i1")?.row).toMatchObject({ title: "back" });
  });

  it("records the local row when the remote edit wins a conflict", () => {
    const local = stateWith(put("items", "i1", 2, "mac", { title: "local" }));
    const result = applyOp(local, put("items", "i1", 2, "phone", { title: "remote" }));
    expect(result.status).toBe("applied");
    expect(result.conflict).toMatchObject({
      table: "items",
      rowId: "i1",
      localRev: 2,
      remoteRev: 2,
      winner: "remote",
      lostRow: { id: "i1", title: "local" },
    });
    expect(result.state.get("items:i1")?.row).toMatchObject({ title: "remote" });
  });

  it("applies a batch in order and keeps the last revision", () => {
    const result = applyBatch(
      new Map(),
      batch("mac", 1, [
        put("items", "i1", 1, "mac", { title: "first" }),
        put("items", "i1", 2, "mac", { title: "second" }),
      ]),
    );
    expect(result.applied).toBe(2);
    expect(result.state.get("items:i1")?.row).toMatchObject({ title: "second" });
  });

  it("rejects an invalid batch without applying any of it", () => {
    const before = stateWith(put("items", "kept", 1, "mac"));
    const bad = batch("mac", 1, [
      put("items", "i1", 1, "mac"),
      { ...put("items", "i2", 1, "mac"), table: "nope" as SyncTable },
    ]);
    expect(() => applyBatch(before, bad)).toThrow(SyncFormatError);
    expect([...before.keys()]).toEqual(["items:kept"]);
  });

  it("increments the local revision from whatever was last applied", () => {
    const state = stateWith(put("items", "i1", 4, "phone"));
    const result = localPut(state, "mac", "items", { id: "i1", title: "mine" }, 100);
    expect(result.op.rev).toBe(5);
    expect(result.op.clock).toEqual({ phone: 4, mac: 1 });
    expect(result.op.writer).toBe("mac");
    const deleted = localDelete(result.state, "mac", "items", "i1", 101);
    expect(deleted.op.rev).toBe(6);
    expect(deleted.op.clock).toEqual({ phone: 4, mac: 2 });
  });

  it("adopts a causally later remote clock into the local state", () => {
    let state = stateWith({ ...put("items", "i1", 1, "phone"), clock: { phone: 1 } });
    const local = localPut(state, "mac", "items", { id: "i1", title: "mine" }, 100);
    state = local.state;
    expect(state.get("items:i1")?.clock).toEqual({ phone: 1, mac: 1 });

    const remote = {
      ...put("items", "i1", 2, "phone", { title: "theirs" }),
      clock: { phone: 2, mac: 1 },
    };
    const applied = applyOp(state, remote);
    expect(applied.status).toBe("applied");
    expect(applied.state.get("items:i1")?.clock).toEqual({ phone: 2, mac: 1 });
  });
});

describe("snapshots", () => {
  it("round-trips live rows and tombstones through a snapshot", () => {
    const state = stateWith(
      put("items", "i1", 1, "mac", { title: "A" }),
      del("items", "i2", 2, "mac"),
    );
    const snapshot = buildSnapshot(state, {
      workspaceId: WORKSPACE,
      deviceId: "mac",
      seq: 2,
      included: { mac: 2 },
    });
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].clock).toEqual({ mac: 1 });
    expect(snapshot.tombstones).toHaveLength(1);
    expect(snapshot.tombstones[0].clock).toEqual({ mac: 2 });

    const replayed = applySnapshot(new Map(), snapshot).state;
    expect([...replayed.entries()]).toEqual([...state.entries()]);
  });

  it("requires the snapshot to cover its own sequence", () => {
    const state = stateWith(put("items", "i1", 1, "mac"));
    expect(() =>
      buildSnapshot(state, {
        workspaceId: WORKSPACE,
        deviceId: "mac",
        seq: 1,
        included: {},
      }),
    ).toThrow(SyncFormatError);

    const snapshot = buildSnapshot(state, {
      workspaceId: WORKSPACE,
      deviceId: "mac",
      seq: 1,
      included: { mac: 1 },
    });
    expect(() =>
      validateSnapshot({ ...snapshot, included: { mac: 0 } }),
    ).toThrow(SyncFormatError);
  });

  it("only raises cursors when merging an included map", () => {
    const next = mergeCursors(new Map([["phone", 5]]), { phone: 3, mac: 2 });
    expect(next.get("phone")).toBe(5);
    expect(next.get("mac")).toBe(2);
  });

  it("reads the previous data version", () => {
    const state = stateWith(put("items", "i1", 1, "mac"));
    const snapshot = buildSnapshot(state, {
      workspaceId: WORKSPACE,
      deviceId: "mac",
      seq: 1,
      included: { mac: 1 },
    });
    expect(
      validateSnapshot({ ...snapshot, dataVersion: SYNC_DATA_VERSION - 1 }).dataVersion,
    ).toBe(SYNC_DATA_VERSION - 1);
    expect(
      validateBatch({
        ...batch("mac", 1, [put("items", "i1", 1, "mac")]),
        dataVersion: SYNC_DATA_VERSION - 1,
      }).dataVersion,
    ).toBe(SYNC_DATA_VERSION - 1);
  });

  it("rejects duplicate rows and newer versions", () => {
    const state = stateWith(put("items", "i1", 1, "mac"));
    const snapshot = buildSnapshot(state, {
      workspaceId: WORKSPACE,
      deviceId: "mac",
      seq: 1,
      included: { mac: 1 },
    });
    expect(() =>
      validateSnapshot({ ...snapshot, rows: [snapshot.rows[0], snapshot.rows[0]] }),
    ).toThrow(SyncFormatError);
    expect(() => validateSnapshot({ ...snapshot, version: 2 })).toThrow(SyncFormatError);
    expect(() => validateSnapshot({ ...snapshot, dataVersion: SYNC_DATA_VERSION + 1 })).toThrow(SyncFormatError);
  });
});

describe("field-level merge", () => {
  const base = { id: "i1", title: "Base", body: "", dueAt: null, tagIds: ["a"] };

  it("combines changes to different fields", () => {
    const local = { ...base, title: "Mine" };
    const remote = { ...base, dueAt: 5 };
    expect(mergeRows(base, local, remote, "remote")).toMatchObject({
      id: "i1",
      title: "Mine",
      dueAt: 5,
    });
  });

  it("uses the deterministic winner when both sides change one field", () => {
    const local = { ...base, title: "Mine" };
    const remote = { ...base, title: "Theirs" };
    expect(mergeRows(base, local, remote, "remote").title).toBe("Theirs");
    expect(mergeRows(base, local, remote, "local").title).toBe("Mine");
  });

  it("combines concurrent tag additions and keeps a shared removal", () => {
    const local = { ...base, tagIds: ["a", "b"] };
    const remote = { ...base, tagIds: ["a", "c"] };
    expect(mergeRows(base, local, remote, "remote").tagIds).toEqual(["a", "b", "c"]);

    const removed = { ...base, tagIds: [] as string[] };
    expect(mergeRows(base, removed, { ...base, tagIds: ["a", "d"] }, "remote").tagIds).toEqual([
      "d",
    ]);
  });

  it("falls back to the winner without a common base", () => {
    const local = { ...base, title: "Mine", dueAt: 5 };
    const remote = { ...base, title: "Theirs" };
    const merged = mergeRows(undefined, local, remote, "remote");
    expect(merged.title).toBe("Theirs");
    expect(merged.dueAt).toBeNull();
  });
});

describe("validation", () => {
  it("parses a workspace file and rejects a newer one", () => {
    const workspace = {
      format: "tempo-sync-workspace",
      version: 1,
      workspaceId: WORKSPACE,
      createdAt: 1,
      createdBy: "mac",
    };
    expect(parseWorkspace(JSON.stringify(workspace))).toMatchObject({
      workspaceId: WORKSPACE,
      createdBy: "mac",
    });
    expect(() => parseWorkspace(JSON.stringify({ ...workspace, version: 2 }))).toThrow(
      /newer version/,
    );
  });

  it("rejects malformed JSON and wrong workspaces", () => {
    expect(() => parseBatch("{")).toThrow(SyncFormatError);
    const valid = batch("mac", 1, [put("items", "i1", 1, "mac")]);
    expect(() => validateBatch(valid, "other")).toThrow(/another workspace/);
  });

  it("rejects a put whose row id differs from its op id", () => {
    const bad = batch("mac", 1, [
      { ...put("items", "i1", 1, "mac"), row: { id: "other" } },
    ]);
    expect(() => validateBatch(bad)).toThrow(/does not match/);
  });

  it("rejects a delete that carries a row", () => {
    const bad = batch("mac", 1, [
      { ...del("items", "i1", 1, "mac"), row: { id: "i1" } },
    ]);
    expect(() => validateBatch(bad)).toThrow(/must not carry/);
  });

  it("rejects an op written by another device", () => {
    const bad = batch("mac", 1, [put("items", "i1", 1, "phone")]);
    expect(() => validateBatch(bad)).toThrow(/another device/);
  });

  it("preserves a causal clock and rejects one without its writer", () => {
    const clocked = { ...put("items", "i1", 1, "mac"), clock: { mac: 1, phone: 2 } };
    expect(validateBatch(batch("mac", 1, [clocked])).ops[0].clock).toEqual({
      mac: 1,
      phone: 2,
    });

    const bad = { ...put("items", "i1", 1, "mac"), clock: { phone: 2 } };
    expect(() => validateBatch(batch("mac", 1, [bad]))).toThrow(/writer/);
  });

  it("rejects unknown tables, empty batches and newer versions", () => {
    expect(() =>
      validateBatch(
        batch("mac", 1, [{ ...put("items", "i1", 1, "mac"), table: "nope" as SyncTable }]),
      ),
    ).toThrow(/unknown table/);
    expect(() => validateBatch(batch("mac", 1, []))).toThrow(/empty/);
    expect(() =>
      validateBatch({ ...batch("mac", 1, [put("items", "i1", 1, "mac")]), version: 2 }),
    ).toThrow(/newer version/);
    expect(() =>
      validateBatch({
        ...batch("mac", 1, [put("items", "i1", 1, "mac")]),
        dataVersion: SYNC_DATA_VERSION + 1,
      }),
    ).toThrow(/newer version/);
  });
});

describe("referential repair", () => {
  it("clears only references with a known tombstone", () => {
    const state = stateWith(
      del("projects", "p1", 2, "mac"),
      del("tags", "t1", 2, "mac"),
      del("members", "m1", 2, "mac"),
      del("workProjects", "wp1", 2, "mac"),
      del("items", "i2", 2, "mac"),
      del("schedules", "s1", 2, "mac"),
      del("habits", "h1", 2, "mac"),
      put("items", "i3", 1, "mac", { title: "live parent" }),
      put("items", "i1", 3, "phone", {
        title: "Task",
        projectId: "p1",
        tagIds: ["t1", "t2"],
        assigneeIds: ["m1"],
        parentId: "i2",
        recurrenceParentId: "i3",
        workProjectId: "wp1",
      }),
      put("items", "i4", 1, "mac", { title: "Unknown parent", projectId: "missing" }),
      put("goals", "g1", 1, "mac", { title: "Goal", projectId: "p1" }),
      put("workProjects", "wp2", 1, "mac", {
        name: "Plan",
        calendarId: "p1",
        memberIds: ["m1", "m2"],
      }),
      put("scheduleItems", "si1", 1, "mac", { scheduleId: "s1", name: "Dead" }),
      put("scheduleItems", "si2", 1, "mac", { scheduleId: "s2", name: "Unknown" }),
      put("habitCheckins", "hc1", 1, "mac", { habitId: "h1", day: 1 }),
      put("habitCheckins", "hc2", 1, "mac", { habitId: "h2", day: 1 }),
      put("taskDependencies", "d1", 1, "mac", {
        predecessorId: "i2",
        successorId: "i3",
      }),
      put("taskDependencies", "d2", 1, "mac", {
        predecessorId: "i3",
        successorId: "i4",
      }),
      put("taskDependencies", "d3", 1, "mac", {
        predecessorId: "i4",
        successorId: "i2",
      }),
    );

    const repaired = repairReferences(state).state;
    const item = repaired.get("items:i1")?.row;
    expect(item).toMatchObject({
      projectId: null,
      tagIds: ["t2"],
      assigneeIds: [],
      parentId: null,
      recurrenceParentId: "i3",
      workProjectId: null,
    });
    expect(repaired.get("items:i4")?.row?.projectId).toBe("missing");
    expect(repaired.get("goals:g1")?.row?.projectId).toBeNull();
    expect(repaired.get("workProjects:wp2")?.row).toMatchObject({
      calendarId: null,
      memberIds: ["m2"],
    });
    expect(repaired.get("scheduleItems:si1")?.deleted).toBe(true);
    expect(repaired.get("scheduleItems:si2")?.deleted).toBe(false);
    expect(repaired.get("habitCheckins:hc1")?.deleted).toBe(true);
    expect(repaired.get("habitCheckins:hc2")?.deleted).toBe(false);
    expect(repaired.get("taskDependencies:d1")?.deleted).toBe(true);
    expect(repaired.get("taskDependencies:d2")?.deleted).toBe(false);
    expect(repaired.get("taskDependencies:d3")?.deleted).toBe(true);
  });

  it("is idempotent", () => {
    const state = stateWith(
      del("projects", "p1", 2, "mac"),
      put("items", "i1", 1, "mac", { projectId: "p1" }),
    );
    const once = repairReferences(state);
    const twice = repairReferences(once.state);
    expect(twice.changes).toHaveLength(0);
    expect([...twice.state.entries()]).toEqual([...once.state.entries()]);
  });
});
