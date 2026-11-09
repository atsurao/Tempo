import Dexie, { type Table } from "dexie";
import { DEFAULT_WORKING_DAYS, PALETTE } from "../types";
import type {
  FocusSession,
  Goal,
  GoalSpan,
  Habit,
  HabitCheckin,
  Item,
  Member,
  Project,
  Schedule,
  ScheduleBreak,
  ScheduleException,
  ScheduleItem,
  Tag,
  TaskDependency,
  WorkProject,
} from "../types";
import { uid } from "../lib/id";
import {
  MAX_BATCH_BYTES,
  MAX_BATCH_OPS,
  SYNC_DATA_VERSION,
  SYNC_FORMAT_VERSION,
  SYNCED_TABLE_SET,
  type JournalBatch,
  type SyncConflictRow,
  type SyncCursorRow,
  type SyncDeviceRow,
  type SyncOp,
  type SyncOutboxRow,
  type SyncRow,
  type SyncStateRow,
  type SyncTable,
} from "../lib/sync/types";
import { clockOf, incrementClock } from "../lib/sync/merge";
import {
  bypassCurrentSyncTransaction,
  installSyncWriteGuard,
  permitCurrentSyncWrite,
} from "../lib/sync/writeGuard";
import { descendantIds, isDone } from "../lib/tasks";
import { nextOccurrence, untilBefore } from "../lib/recurrence";
import { goalEnd } from "../lib/goals";
import { hourLaterSameDay, sod } from "../lib/date";
import { scheduleExceptionId } from "../lib/schedule";

export interface SettingRow {
  key: string;
  value: unknown;
}

class TempoDB extends Dexie {
  items!: Table<Item, string>;
  projects!: Table<Project, string>;
  tags!: Table<Tag, string>;
  focusSessions!: Table<FocusSession, string>;
  goals!: Table<Goal, string>;
  schedules!: Table<Schedule, string>;
  scheduleItems!: Table<ScheduleItem, string>;
  scheduleBreaks!: Table<ScheduleBreak, string>;
  scheduleExceptions!: Table<ScheduleException, string>;
  workProjects!: Table<WorkProject, string>;
  members!: Table<Member, string>;
  taskDependencies!: Table<TaskDependency, string>;
  habits!: Table<Habit, string>;
  habitCheckins!: Table<HabitCheckin, string>;
  settings!: Table<SettingRow, string>;

  /** Sync journal metadata. Local only; never part of a JSON backup. */
  syncDevice!: Table<SyncDeviceRow, string>;
  syncState!: Table<SyncStateRow, string>;
  syncOutbox!: Table<SyncOutboxRow, number>;
  syncCursors!: Table<SyncCursorRow, string>;
  syncConflicts!: Table<SyncConflictRow, number>;

  constructor() {
    super("tempo");
    this.version(1).stores({
      items:
        "id, type, start, end, dueAt, parentId, projectId, status, completedAt, recurrenceParentId, updatedAt, *tagIds",
      projects: "id, order",
      tags: "id, name",
      focusSessions: "id, startedAt, taskId",
      settings: "key",
    });
    // v2 adds goals. Existing items are untouched by the upgrade.
    this.version(2).stores({
      goals: "id, span, start, end, projectId, completedAt, updatedAt, order",
    });
    // v3 adds fixed weekly schedules and the breaks that pause them.
    this.version(3).stores({
      schedules: "id, name, order, updatedAt",
      scheduleItems: "id, scheduleId, order",
      scheduleBreaks: "id, scheduleId, from, to",
    });
    // v4 adds work projects, their members and dependency links. Item rows gain
    // a `workProjectId` index but no existing row is rewritten.
    this.version(4).stores({
      items:
        "id, type, start, end, dueAt, parentId, projectId, workProjectId, status, completedAt, recurrenceParentId, updatedAt, *tagIds",
      workProjects: "id, order, updatedAt, calendarId, archivedAt",
      members: "id, name, updatedAt",
      taskDependencies:
        "id, workProjectId, predecessorId, successorId, &[predecessorId+successorId]",
    });
    // v5 adds habits and the days they were done. Existing rows are untouched.
    this.version(5).stores({
      habits: "id, order, archivedAt, updatedAt",
      habitCheckins: "id, habitId, day",
    });
    // v6 adds the sync journal metadata. Domain rows are unchanged; these
    // tables stay empty until sync is enabled in a later phase.
    this.version(6).stores({
      syncDevice: "key",
      syncState: "key, table, [table+id], rev",
      syncOutbox: "seq, state",
      syncCursors: "deviceId",
      syncConflicts: "++id, at, table, expiresAt",
    });
    // v7 adds one-off timetable edits and deletions. The recurring plan stays
    // in scheduleItems; these rows only target a single session on a day.
    this.version(7).stores({
      scheduleExceptions: "id, scheduleId, sessionId, &[sessionId+day], updatedAt",
    });
  }
}

export const db = new TempoDB();
installSyncWriteGuard(db);

export class SyncWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncWriteError";
  }
}

/**
 * A whole-workspace replacement is never journaled. Refuse while sync is on.
 * A paused device is safe: its journal is still local, and restore clears it.
 */
export async function assertSyncDisabled(action: string): Promise<void> {
  const device = await db.syncDevice.get("local");
  if (device?.enabled && !device.paused) {
    throw new SyncWriteError(`Turn off sync on this device before ${action}.`);
  }
}

export interface SyncTx {
  put<T extends { id: string }>(table: SyncTable, row: T): Promise<void>;
  patch<T extends { id: string }>(
    table: SyncTable,
    id: string,
    patch: Partial<T>,
  ): Promise<void>;
  del(table: SyncTable, id: string): Promise<void>;
}

interface OpenJournal {
  device: SyncDeviceRow;
  ops: SyncOp[];
  at: number;
}

export interface SyncWriteOptions {
  /** Bulk writes may emit ordered batches inside the one local transaction. */
  allowSplit?: boolean;
}

export function journalBatch(
  device: SyncDeviceRow,
  ops: SyncOp[],
  seq: number,
  at: number,
): JournalBatch {
  return {
    format: "tempo-sync-batch",
    version: SYNC_FORMAT_VERSION,
    workspaceId: device.workspaceId,
    deviceId: device.deviceId,
    seq,
    createdAt: at,
    dataVersion: SYNC_DATA_VERSION,
    ops,
  };
}

function batchBytes(batch: JournalBatch): number {
  return new TextEncoder().encode(JSON.stringify(batch)).byteLength;
}

/**
 * Keep normal batches whole. A bulk caller opts into ordered chunks so one
 * oversized import cannot abort the local transaction.
 */
function splitOps(
  ops: SyncOp[],
  device: SyncDeviceRow,
  at: number,
  allowSplit: boolean,
): SyncOp[][] {
  if (ops.length > MAX_BATCH_OPS && !allowSplit) {
    throw new SyncWriteError("That change is too large for one sync batch.");
  }

  const countChunks: SyncOp[][] = [];
  for (let index = 0; index < ops.length; index += MAX_BATCH_OPS) {
    countChunks.push(ops.slice(index, index + MAX_BATCH_OPS));
  }

  const chunks: SyncOp[][] = [];
  const visit = (chunk: SyncOp[]): void => {
    if (chunk.length === 0) return;
    if (batchBytes(journalBatch(device, chunk, 0, at)) <= MAX_BATCH_BYTES) {
      chunks.push(chunk);
      return;
    }
    if (!allowSplit || chunk.length === 1) {
      throw new SyncWriteError("That change is too large for one sync batch.");
    }
    const middle = Math.ceil(chunk.length / 2);
    visit(chunk.slice(0, middle));
    visit(chunk.slice(middle));
  };
  for (const chunk of countChunks) visit(chunk);
  return chunks;
}

/**
 * The only domain-write path. The domain row, its syncState revision and the
 * outbox batch are committed in one Dexie transaction, so a crash cannot leave
 * a local edit with no journal entry. When no enabled device exists the same
 * helper writes locally without journaling. A paused device still journals:   * only its folder reads and writes stop.
 */
export async function syncedTransaction(
  tables: Table[],
  fn: (tx: SyncTx) => Promise<void>,
  options: SyncWriteOptions = {},
): Promise<void> {
  await db.transaction(
    "rw",
    [...tables, db.syncDevice, db.syncState, db.syncOutbox],
    async () => {
      const device = await db.syncDevice.get("local");
      let journal: OpenJournal | null = device?.enabled
        ? { device, ops: [], at: Date.now() }
        : null;

      const putRow = async (table: SyncTable, row: SyncRow): Promise<void> => {
        if (!SYNCED_TABLE_SET.has(table)) {
          throw new SyncWriteError(`Unknown sync table: ${table}.`);
        }
        const previous = journal
          ? ((await db.table(table).get(row.id)) as SyncRow | undefined)
          : undefined;
        permitCurrentSyncWrite();
        await db.table(table).put(row);
        if (!journal) return;
        const key = `${table}:${row.id}`;
        const state = await db.syncState.get(key);
        const rev = (state?.rev ?? 0) + 1;
        const at = journal.at;
        const clock = incrementClock(
          state ? clockOf(state.rev, state.writer, state.clock) : undefined,
          journal.device.deviceId,
        );
        await db.syncState.put({
          key,
          table,
          id: row.id,
          rev,
          writer: journal.device.deviceId,
          deleted: false,
          at,
          clock,
          // A new row is its own merge base until a peer changes it.
          baseRow: state?.baseRow ?? previous ?? row,
        });
        journal.ops.push({
          table,
          id: row.id,
          kind: "put",
          rev,
          writer: journal.device.deviceId,
          at,
          clock,
          row,
        });
      };

      const del = async (table: SyncTable, id: string): Promise<void> => {
        if (!SYNCED_TABLE_SET.has(table)) {
          throw new SyncWriteError(`Unknown sync table: ${table}.`);
        }
        const previous = journal
          ? ((await db.table(table).get(id)) as SyncRow | undefined)
          : undefined;
        permitCurrentSyncWrite();
        await db.table(table).delete(id);
        if (!journal) return;
        const key = `${table}:${id}`;
        const state = await db.syncState.get(key);
        const rev = (state?.rev ?? 0) + 1;
        const at = journal.at;
        const clock = incrementClock(
          state ? clockOf(state.rev, state.writer, state.clock) : undefined,
          journal.device.deviceId,
        );
        await db.syncState.put({
          key,
          table,
          id,
          rev,
          writer: journal.device.deviceId,
          deleted: true,
          at,
          clock,
          baseRow: state?.baseRow ?? previous,
        });
        journal.ops.push({
          table,
          id,
          kind: "del",
          rev,
          writer: journal.device.deviceId,
          at,
          clock,
        });
      };

      const tx: SyncTx = {
        put: putRow,
        del,
        patch: async (table, id, patch) => {
          const existing = (await db.table(table).get(id)) as SyncRow | undefined;
          if (!existing) return;
          await putRow(table, { ...existing, ...patch, id });
        },
      };

      await fn(tx);

      if (journal && journal.ops.length > 0) {
        const chunks = splitOps(
          journal.ops,
          journal.device,
          journal.at,
          options.allowSplit === true,
        );
        const batches = chunks.map((ops, index) =>
          journalBatch(
            journal.device,
            ops,
            journal.device.lastSeq + index + 1,
            journal.at,
          ),
        );
        for (const batch of batches) {
          await db.syncOutbox.add({
            seq: batch.seq,
            batch,
            state: "pending",
            createdAt: journal.at,
          });
        }
        await db.syncDevice.update("local", {
          lastSeq: batches[batches.length - 1].seq,
        });
      }
    },
  );
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export type NewItem = Partial<Item> & { type: Item["type"]; title: string };

export async function createItem(patch: NewItem, extra: Partial<Item> = {}): Promise<Item> {
  const now = Date.now();
  const item: Item = {
    id: uid(),
    status: patch.type === "task" ? "todo" : undefined,
    priority: patch.type === "task" ? 0 : undefined,
    tagIds: [],
    reminders: [],
    order: now % 1_000_000,
    createdAt: now,
    updatedAt: now,
    ...patch,
    ...extra,
  };
  await syncedTransaction([db.items], async (tx) => {
    await tx.put("items", item);
  });
  return item;
}

export async function updateItem(id: string, patch: Partial<Item>): Promise<void> {
  await syncedTransaction([db.items], async (tx) => {
    await tx.patch<Item>("items", id, { ...patch, updatedAt: Date.now() });
  });
}

/**
 * Soft delete with cascade. Kept restorable so the UI can offer undo.
 */
export async function softDeleteItem(id: string): Promise<void> {
  const now = Date.now();
  await syncedTransaction([db.items], async (tx) => {
    const items = await db.items.toArray();
    const exceptions = items
      .filter((i) => i.recurrenceParentId === id)
      .map((i) => i.id);
    // Children first, parent last: a split batch must not show the parent gone
    // before its descendants are repaired.
    const ids = [...descendantIds(items, id), ...exceptions, id];
    for (const itemId of ids) {
      const item = items.find((i) => i.id === itemId);
      if (item) await tx.put("items", { ...item, deletedAt: now, updatedAt: now });
    }
  }, { allowSplit: true });
}

export async function restoreItem(id: string): Promise<void> {
  await syncedTransaction([db.items], async (tx) => {
    await tx.patch<Item>("items", id, { deletedAt: null, updatedAt: Date.now() });
  });
}

export async function purgeItem(id: string): Promise<void> {
  await syncedTransaction([db.items], async (tx) => {
    await tx.del("items", id);
  });
}

/** Restore a deleted item together with the descendants removed with it. */
export async function restoreSubtree(id: string): Promise<void> {
  await syncedTransaction([db.items], async (tx) => {
    const items = await db.items.toArray();
    const root = items.find((i) => i.id === id);
    const stamp = root?.deletedAt;
    const exceptions = items
      .filter((i) => i.recurrenceParentId === id)
      .map((i) => i.id);
    const ids = [id, ...descendantIds(items, id), ...exceptions];
    for (const itemId of ids) {
      const item = items.find((i) => i.id === itemId);
      if (item && (itemId === id || item.deletedAt === stamp)) {
        await tx.put("items", { ...item, deletedAt: null, updatedAt: Date.now() });
      }
    }
  }, { allowSplit: true });
}

/**
 * Complete/uncomplete a task and its subtree. Completing a recurring task
 * rolls its due date to the next occurrence and reports the new date.
 */
export async function toggleTaskComplete(item: Item): Promise<{ nextDue?: number }> {
  const now = Date.now();
  const completing = !isDone(item);

  await syncedTransaction([db.items], async (tx) => {
    const items = await db.items.toArray();
    const ids = [item.id, ...descendantIds(items, item.id)];
    for (const itemId of ids) {
      const existing = items.find((i) => i.id === itemId);
      if (!existing) continue;
      const isParent = itemId === item.id;
      const rollForward = isParent && completing && item.recurrence;
      const patch: Partial<Item> = {
        completedAt: completing ? now : null,
        status: completing ? "done" : "todo",
        progressPct: completing ? 100 : 0,
        updatedAt: now,
      };
      if (rollForward) {
        const anchor = item.start ?? item.dueAt ?? now;
        const next = nextOccurrence(item, anchor);
        if (next != null) {
          if (item.start != null) {
            const duration = (item.end ?? item.start) - item.start;
            patch.start = next;
            patch.end = next + duration;
          } else {
            patch.dueAt = next;
          }
          patch.completedAt = null;
          patch.status = "todo";
          patch.progressPct = 0;
        }
      }
      if (!completing && existing.status === "doing") patch.status = "todo";
      await tx.put("items", { ...existing, ...patch });
    }
  }, { allowSplit: true });

  if (completing && item.recurrence) {
    const anchor = item.start ?? item.dueAt ?? now;
    const next = nextOccurrence(item, anchor);
    return next ? { nextDue: next } : {};
  }
  return {};
}

export async function setTaskStatus(item: Item, status: Item["status"]): Promise<void> {
  const now = Date.now();
  await syncedTransaction([db.items], async (tx) => {
    const items = await db.items.toArray();
    const ids = [item.id, ...descendantIds(items, item.id)];
    for (const itemId of ids) {
      const existing = items.find((i) => i.id === itemId);
      if (!existing) continue;
      await tx.put("items", {
        ...existing,
        status,
        completedAt: status === "done" ? now : null,
        progressPct: status === "done" ? 100 : status === "doing" ? 50 : 0,
        updatedAt: now,
      });
    }
  }, { allowSplit: true });
}

/**
 * Save an edit to a single occurrence of a series by materializing an
 * exception that points back at the master.
 */
export async function overrideOccurrence(
  master: Item,
  originalStart: number,
  patch: Partial<Item>,
): Promise<string> {
  let resultId = "";
  await syncedTransaction([db.items], async (tx) => {
    const existing = await db.items
      .where("recurrenceParentId")
      .equals(master.id)
      .filter((i) => i.originalStart === originalStart)
      .first();
    const now = Date.now();
    if (existing) {
      await tx.patch<Item>("items", existing.id, {
        ...patch,
        cancelled: false,
        deletedAt: null,
        updatedAt: now,
      });
      resultId = existing.id;
      return;
    }
    const copy: Item = {
      ...master,
      ...patch,
      id: uid(),
      recurrenceParentId: master.id,
      originalStart,
      recurrence: null,
      createdAt: now,
      updatedAt: now,
    };
    await tx.put("items", copy);
    resultId = copy.id;
  });
  return resultId;
}

export async function cancelOccurrence(master: Item, originalStart: number): Promise<string> {
  return overrideOccurrence(master, originalStart, { cancelled: true });
}

/** Split a series at an occurrence, keeping earlier history intact. */
export async function splitSeries(
  master: Item,
  originalStart: number,
  patch: Partial<Item>,
): Promise<void> {
  const now = Date.now();
  const stamp = untilBefore(originalStart);
  const baseRule = (master.recurrence?.rrule ?? "FREQ=DAILY")
    .replace(/;(UNTIL|COUNT)=[^;]+/g, "")
    .replace(/^(UNTIL|COUNT)=[^;]+;?/, "");

  const newId = uid();
  await syncedTransaction([db.items], async (tx) => {
    await tx.patch<Item>("items", master.id, {
      recurrence: { rrule: `${baseRule};UNTIL=${stamp}` },
      updatedAt: now,
    });
    await tx.put("items", {
      ...master,
      ...patch,
      id: newId,
      start: patch.start ?? originalStart,
      end: patch.end ?? (patch.start ?? originalStart) + ((master.end ?? master.start ?? 0) - (master.start ?? 0)),
      recurrence: patch.recurrence ?? master.recurrence,
      recurrenceParentId: null,
      originalStart: null,
      createdAt: now,
      updatedAt: now,
    });
    const moved = await db.items.where("recurrenceParentId").equals(master.id).toArray();
    for (const item of moved) {
      if ((item.originalStart ?? 0) >= originalStart) {
        await tx.put("items", { ...item, recurrenceParentId: newId, updatedAt: now });
      }
    }
  }, { allowSplit: true });
}

/* ------------------------------------------------------------------ goals */

export type NewGoal = Partial<Goal> & { title: string; span: GoalSpan };

/**
 * Goals own their horizon: the span decides the end date unless one is given.
 * "Until completion" stores no end at all.
 */
export async function createGoal(patch: NewGoal, extra: Partial<Goal> = {}): Promise<Goal> {
  const now = Date.now();
  const start = patch.start != null ? sod(patch.start) : sod(now);
  const span = patch.span;
  const goal: Goal = {
    id: uid("g"),
    projectId: null,
    body: undefined,
    order: now % 1_000_000,
    ...patch,
    span,
    start,
    end: patch.end !== undefined ? patch.end : goalEnd(span, start),
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  await syncedTransaction([db.goals], async (tx) => {
    await tx.put("goals", goal);
  });
  return goal;
}

/**
 * Patch a goal. Changing the span recomputes the horizon, so switching between
 * month, year and until-completion always leaves a consistent end date.
 */
export async function updateGoal(id: string, patch: Partial<Goal>): Promise<void> {
  await syncedTransaction([db.goals], async (tx) => {
    const existing = await db.goals.get(id);
    if (!existing) return;
    const span = patch.span ?? existing.span;
    const start = patch.start != null ? sod(patch.start) : existing.start;
    const resetsEnd = patch.span !== undefined || patch.start !== undefined;
    await tx.put("goals", {
      ...existing,
      ...patch,
      span,
      start,
      end: patch.end !== undefined ? patch.end : resetsEnd ? goalEnd(span, start) : existing.end,
      updatedAt: Date.now(),
    });
  });
}

export async function setGoalDone(id: string, done: boolean): Promise<void> {
  await syncedTransaction([db.goals], async (tx) => {
    await tx.patch<Goal>("goals", id, {
      completedAt: done ? Date.now() : null,
      updatedAt: Date.now(),
    });
  });
}

/** Soft delete so the UI can offer undo, matching items. */
export async function softDeleteGoal(id: string): Promise<void> {
  await syncedTransaction([db.goals], async (tx) => {
    await tx.patch<Goal>("goals", id, { deletedAt: Date.now(), updatedAt: Date.now() });
  });
}

export async function restoreGoal(id: string): Promise<void> {
  await syncedTransaction([db.goals], async (tx) => {
    await tx.patch<Goal>("goals", id, { deletedAt: null, updatedAt: Date.now() });
  });
}

export async function createProject(name: string, color: string, order: number): Promise<Project> {
  const project: Project = { id: uid("p"), name, color, order };
  await syncedTransaction([db.projects], async (tx) => {
    await tx.put("projects", project);
  });
  return project;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  await syncedTransaction([db.projects], async (tx) => {
    await tx.patch<Project>("projects", id, patch);
  });
}

/**
 * A work project is a plan, not a calendar. It starts today by default, works
 * Monday to Friday and has no roster until someone is added to it.
 */
export async function createWorkProject(input: {
  name: string;
  color: string;
  order: number;
  start?: number;
  deadline?: number | null;
  workingDays?: number[];
  calendarId?: string | null;
  description?: string;
}): Promise<WorkProject> {
  const now = Date.now();
  const project: WorkProject = {
    id: uid("wp"),
    name: input.name,
    description: input.description,
    color: input.color,
    calendarId: input.calendarId ?? null,
    start: sod(input.start ?? now),
    deadline: input.deadline ?? null,
    workingDays: input.workingDays?.length ? input.workingDays : [...DEFAULT_WORKING_DAYS],
    memberIds: [],
    order: input.order,
    createdAt: now,
    updatedAt: now,
  };
  await syncedTransaction([db.workProjects], async (tx) => {
    await tx.put("workProjects", project);
  });
  return project;
}

export async function updateWorkProject(id: string, patch: Partial<WorkProject>): Promise<void> {
  await syncedTransaction([db.workProjects], async (tx) => {
    await tx.patch<WorkProject>("workProjects", id, { ...patch, updatedAt: Date.now() });
  });
}

/** A local person on a project roster. No account, no email, just a label. */
export async function createMember(input: {
  name: string;
  color?: string;
  role?: string;
}): Promise<Member> {
  const now = Date.now();
  const member: Member = {
    id: uid("mem"),
    name: input.name.trim() || "Teammate",
    color: input.color ?? PALETTE[0],
    role: input.role?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await syncedTransaction([db.members], async (tx) => {
    await tx.put("members", member);
  });
  return member;
}

export async function updateMember(id: string, patch: Partial<Member>): Promise<void> {
  await syncedTransaction([db.members], async (tx) => {
    await tx.patch<Member>("members", id, { ...patch, updatedAt: Date.now() });
  });
}

/** Remove a person everywhere: roster, assignments and the member table. */
export async function deleteMember(id: string): Promise<void> {
  const now = Date.now();
  await syncedTransaction([db.members, db.workProjects, db.items], async (tx) => {
    const projects = await db.workProjects.toArray();
    for (const project of projects) {
      if (!project.memberIds.includes(id)) continue;
      await tx.put("workProjects", {
        ...project,
        memberIds: project.memberIds.filter((memberId) => memberId !== id),
        updatedAt: now,
      });
    }
    const items = await db.items.toArray();
    for (const item of items) {
      if (!item.assigneeIds?.includes(id)) continue;
      await tx.put("items", {
        ...item,
        assigneeIds: item.assigneeIds.filter((memberId) => memberId !== id),
        updatedAt: now,
      });
    }
    await tx.del("members", id);
  }, { allowSplit: true });
}

export async function addProjectMember(projectId: string, memberId: string): Promise<void> {
  await syncedTransaction([db.workProjects], async (tx) => {
    const project = await db.workProjects.get(projectId);
    if (!project || project.memberIds.includes(memberId)) return;
    await tx.put("workProjects", {
      ...project,
      memberIds: [...project.memberIds, memberId],
      updatedAt: Date.now(),
    });
  });
}

/** Taking someone off the roster also clears their work on this project. */
export async function removeProjectMember(projectId: string, memberId: string): Promise<void> {
  const now = Date.now();
  await syncedTransaction([db.workProjects, db.items], async (tx) => {
    const project = await db.workProjects.get(projectId);
    if (!project) return;
    await tx.put("workProjects", {
      ...project,
      memberIds: project.memberIds.filter((id) => id !== memberId),
      updatedAt: now,
    });
    const tasks = await db.items.where("workProjectId").equals(projectId).toArray();
    for (const task of tasks) {
      if (!task.assigneeIds?.includes(memberId)) continue;
      await tx.put("items", {
        ...task,
        assigneeIds: task.assigneeIds.filter((id) => id !== memberId),
        updatedAt: now,
      });
    }
  });
}

/** Finish-to-start links are unique per task pair and count lag in working days. */
export async function createTaskDependency(input: {
  workProjectId: string;
  predecessorId: string;
  successorId: string;
  lagDays?: number;
}): Promise<TaskDependency | null> {
  if (input.predecessorId === input.successorId) return null;
  let dependency: TaskDependency | null = null;
  await syncedTransaction([db.taskDependencies], async (tx) => {
    const existing = await db.taskDependencies
      .where("[predecessorId+successorId]")
      .equals([input.predecessorId, input.successorId])
      .first();
    if (existing) return;
    dependency = {
      id: uid("d"),
      workProjectId: input.workProjectId,
      predecessorId: input.predecessorId,
      successorId: input.successorId,
      type: "FS",
      lagDays: Math.max(0, Math.round(input.lagDays ?? 0)),
      createdAt: Date.now(),
    };
    await tx.put("taskDependencies", dependency);
  });
  return dependency;
}

export async function updateTaskDependency(
  id: string,
  patch: Partial<Pick<TaskDependency, "predecessorId" | "successorId" | "lagDays">>,
): Promise<void> {
  await syncedTransaction([db.taskDependencies], async (tx) => {
    await tx.patch<TaskDependency>("taskDependencies", id, {
      ...patch,
      ...(patch.lagDays != null
        ? { lagDays: Math.max(0, Math.round(patch.lagDays)) }
        : {}),
    });
  });
}

export async function deleteTaskDependency(id: string): Promise<void> {
  await syncedTransaction([db.taskDependencies], async (tx) => {
    await tx.del("taskDependencies", id);
  });
}

export async function deleteProject(id: string): Promise<void> {
  const now = Date.now();
  await syncedTransaction(
    [db.projects, db.items, db.goals, db.workProjects],
    async (tx) => {
      const items = await db.items.where("projectId").equals(id).toArray();
      for (const item of items) {
        await tx.put("items", { ...item, projectId: null, updatedAt: now });
      }
      const goals = await db.goals.where("projectId").equals(id).toArray();
      for (const goal of goals) {
        await tx.put("goals", { ...goal, projectId: null, updatedAt: now });
      }
      const workProjects = await db.workProjects.where("calendarId").equals(id).toArray();
      for (const project of workProjects) {
        await tx.put("workProjects", { ...project, calendarId: null, updatedAt: now });
      }
      await tx.del("projects", id);
    },
    { allowSplit: true },
  );
}

export async function ensureTag(name: string): Promise<Tag> {
  const clean = name.trim().replace(/^#/, "");
  let tag: Tag | null = null;
  await syncedTransaction([db.tags], async (tx) => {
    const existing = await db.tags.where("name").equalsIgnoreCase(clean).first();
    if (existing) {
      tag = existing;
      return;
    }
    tag = { id: uid("t"), name: clean };
    await tx.put("tags", tag);
  });
  if (!tag) throw new SyncWriteError("The tag could not be created.");
  return tag;
}

export async function updateTag(
  id: string,
  patch: Partial<Pick<Tag, "name" | "color">>,
): Promise<void> {
  const next = { ...patch };
  if (next.name != null) next.name = next.name.trim().replace(/^#/, "");
  if (next.name === "") return;
  await syncedTransaction([db.tags], async (tx) => {
    await tx.patch<Tag>("tags", id, next);
  });
}

export async function deleteTag(id: string): Promise<void> {
  const now = Date.now();
  await syncedTransaction([db.tags, db.items], async (tx) => {
    const items = await db.items.toArray();
    for (const item of items) {
      if (item.tagIds?.includes(id)) {
        await tx.put("items", {
          ...item,
          tagIds: item.tagIds.filter((t) => t !== id),
          updatedAt: now,
        });
      }
    }
    await tx.del("tags", id);
  }, { allowSplit: true });
}

export async function logFocusSession(session: Omit<FocusSession, "id">): Promise<void> {
  await syncedTransaction([db.focusSessions], async (tx) => {
    await tx.put("focusSessions", { ...session, id: uid("f") });
  });
}

/** Duplicate an item (and its subtree) onto the same day, one hour later. */
export async function duplicateItem(id: string): Promise<void> {
  await syncedTransaction([db.items], async (tx) => {
    const items = await db.items.toArray();
    const source = items.find((i) => i.id === id);
    if (!source) return;
    const ids = [id, ...descendantIds(items, id)];
    const idMap = new Map<string, string>();
    const now = Date.now();
    const copies: Item[] = [];

    for (const sourceId of ids) {
      const original = items.find((i) => i.id === sourceId);
      if (!original) continue;
      const newId = uid();
      idMap.set(original.id, newId);
      const start =
        original.start != null ? hourLaterSameDay(original.start) : original.start;
      const startShift = original.start != null ? start! - original.start : 0;
      copies.push({
        ...original,
        id: newId,
        title: sourceId === id ? `${original.title} (copy)` : original.title,
        createdAt: now,
        updatedAt: now,
        start,
        end: original.end != null ? original.end + startShift : original.end,
        timeblocks: original.timeblocks?.map((block) => {
          const blockStart = hourLaterSameDay(block.start);
          return {
            ...block,
            id: uid("tb"),
            start: blockStart,
            end: block.end + (blockStart - block.start),
          };
        }),
        dueAt:
          original.dueAt != null ? hourLaterSameDay(original.dueAt) : original.dueAt,
        recurrenceParentId: null,
        originalStart: null,
        cancelled: false,
      });
    }

    for (const copy of copies) {
      if (copy.parentId && idMap.has(copy.parentId)) copy.parentId = idMap.get(copy.parentId)!;
      await tx.put("items", copy);
    }
  }, { allowSplit: true });
}

/* ---------------------------------------------------------------- habits */

export async function createHabit(input: {
  name: string;
  days: number[];
  interval?: number;
  color?: string;
  note?: string;
  start?: number;
}): Promise<Habit> {
  const now = Date.now();
  const habits = await db.habits.toArray();
  const habit: Habit = {
    id: uid("h"),
    name: input.name.trim() || "New habit",
    days: [...new Set(input.days)].sort((a, b) => a - b),
    interval: Math.max(1, Math.round(input.interval ?? 1)),
    color: input.color ?? PALETTE[habits.length % PALETTE.length],
    note: input.note?.trim() || undefined,
    start: sod(input.start ?? now),
    order: habits.reduce((max, h) => Math.max(max, h.order), -1) + 1,
    createdAt: now,
    updatedAt: now,
  };
  await syncedTransaction([db.habits], async (tx) => {
    await tx.put("habits", habit);
  });
  return habit;
}

export async function updateHabit(id: string, patch: Partial<Habit>): Promise<void> {
  await syncedTransaction([db.habits], async (tx) => {
    await tx.patch<Habit>("habits", id, {
      ...patch,
      ...(patch.days ? { days: [...new Set(patch.days)].sort((a, b) => a - b) } : {}),
      ...(patch.interval != null ? { interval: Math.max(1, Math.round(patch.interval)) } : {}),
      ...(patch.start != null ? { start: sod(patch.start) } : {}),
      updatedAt: Date.now(),
    });
  });
}

/** Remove a habit and its history together; there is nothing else pointing at it. */
export async function deleteHabit(id: string): Promise<void> {
  await syncedTransaction([db.habits, db.habitCheckins], async (tx) => {
    const checkins = await db.habitCheckins.where("habitId").equals(id).toArray();
    for (const checkin of checkins) await tx.del("habitCheckins", checkin.id);
    await tx.del("habits", id);
  }, { allowSplit: true });
}

/** Tick or untick a habit for one day. One row per habit per day. */
export async function setHabitDone(habit: Habit, day: number, done: boolean): Promise<void> {
  const id = `${habit.id}:${sod(day)}`;
  await syncedTransaction([db.habitCheckins], async (tx) => {
    if (!done) {
      await tx.del("habitCheckins", id);
      return;
    }
    const existing = await db.habitCheckins.get(id);
    if (existing) return;
    await tx.put("habitCheckins", { id, habitId: habit.id, day: sod(day), createdAt: Date.now() });
  });
}

export async function toggleHabitDone(habit: Habit, day: number): Promise<boolean> {
  const id = `${habit.id}:${sod(day)}`;
  let done = false;
  await syncedTransaction([db.habitCheckins], async (tx) => {
    const existing = await db.habitCheckins.get(id);
    if (existing) {
      await tx.del("habitCheckins", id);
      done = false;
      return;
    }
    await tx.put("habitCheckins", { id, habitId: habit.id, day: sod(day), createdAt: Date.now() });
    done = true;
  });
  return done;
}

/* -------------------------------------------------------------- schedules */

export async function createSchedule(input: {
  name: string;
  color: string;
  order: number;
  /** First and last day the timetable runs, as day starts. */
  from: number;
  to: number;
}): Promise<Schedule> {
  const now = Date.now();
  const schedule: Schedule = {
    id: uid("s"),
    name: input.name,
    color: input.color,
    order: input.order,
    from: sod(input.from),
    to: sod(input.to),
    createdAt: now,
    updatedAt: now,
  };
  await syncedTransaction([db.schedules], async (tx) => {
    await tx.put("schedules", schedule);
  });
  return schedule;
}

export async function updateSchedule(id: string, patch: Partial<Schedule>): Promise<void> {
  await syncedTransaction([db.schedules], async (tx) => {
    await tx.patch<Schedule>("schedules", id, { ...patch, updatedAt: Date.now() });
  });
}

/**
 * Save a schedule's whole weekly plan at once: the rows present when the editor
 * is saved are the rows the schedule has, and anything dropped is removed.
 */
export async function saveSchedulePlan(
  scheduleId: string,
  items: ScheduleItem[],
  breaks: ScheduleBreak[],
): Promise<void> {
  await syncedTransaction(
    [db.scheduleItems, db.scheduleBreaks, db.scheduleExceptions],
    async (tx) => {
      const [oldItems, oldBreaks, oldExceptions] = await Promise.all([
        db.scheduleItems.where("scheduleId").equals(scheduleId).toArray(),
        db.scheduleBreaks.where("scheduleId").equals(scheduleId).toArray(),
        db.scheduleExceptions.where("scheduleId").equals(scheduleId).toArray(),
      ]);
      const keptItems = new Set(items.map((i) => i.id));
      const keptBreaks = new Set(breaks.map((b) => b.id));
      const removedItems = new Set(
        oldItems.filter((row) => !keptItems.has(row.id)).map((row) => row.id),
      );
      for (const item of items) await tx.put("scheduleItems", { ...item, scheduleId });
      for (const item of breaks) await tx.put("scheduleBreaks", { ...item, scheduleId });
      for (const row of oldItems) {
        if (removedItems.has(row.id)) await tx.del("scheduleItems", row.id);
      }
      for (const row of oldBreaks) {
        if (!keptBreaks.has(row.id)) await tx.del("scheduleBreaks", row.id);
      }
      // A one-off edit has no meaning once its weekly session is gone.
      for (const row of oldExceptions) {
        if (removedItems.has(row.sessionId)) await tx.del("scheduleExceptions", row.id);
      }
    },
    { allowSplit: true },
  );
}

export async function deleteSchedule(id: string): Promise<void> {
  await syncedTransaction(
    [db.schedules, db.scheduleItems, db.scheduleBreaks, db.scheduleExceptions],
    async (tx) => {
      const [items, breaks, exceptions] = await Promise.all([
        db.scheduleItems.where("scheduleId").equals(id).toArray(),
        db.scheduleBreaks.where("scheduleId").equals(id).toArray(),
        db.scheduleExceptions.where("scheduleId").equals(id).toArray(),
      ]);
      for (const item of items) await tx.del("scheduleItems", item.id);
      for (const item of breaks) await tx.del("scheduleBreaks", item.id);
      for (const row of exceptions) await tx.del("scheduleExceptions", row.id);
      await tx.del("schedules", id);
    },
    { allowSplit: true },
  );
}

/** Put a deleted timetable back with its sessions, breaks and one-offs. */
export async function restoreSchedule(
  schedule: Schedule,
  items: ScheduleItem[],
  breaks: ScheduleBreak[],
  exceptions: ScheduleException[] = [],
): Promise<void> {
  await syncedTransaction(
    [db.schedules, db.scheduleItems, db.scheduleBreaks, db.scheduleExceptions],
    async (tx) => {
      await tx.put("schedules", schedule);
      for (const item of items) await tx.put("scheduleItems", item);
      for (const item of breaks) await tx.put("scheduleBreaks", item);
      for (const row of exceptions) await tx.put("scheduleExceptions", row);
    },
    { allowSplit: true },
  );
}

/** Create or replace the one-off change for a session on one day. */
export async function saveScheduleException(
  input: Omit<ScheduleException, "id" | "updatedAt">,
): Promise<ScheduleException> {
  const row: ScheduleException = {
    ...input,
    day: sod(input.day),
    id: scheduleExceptionId(input.sessionId, input.day),
    updatedAt: Date.now(),
  };
  await syncedTransaction([db.scheduleExceptions], async (tx) => {
    await tx.put("scheduleExceptions", row);
  });
  return row;
}

/** Hide just this session on this day, leaving the weekly plan alone. */
export async function deleteScheduleOccurrence(
  scheduleId: string,
  sessionId: string,
  day: number,
): Promise<void> {
  await saveScheduleException({ scheduleId, sessionId, day, kind: "delete" });
}

/** Remove an exception entirely, restoring the generated occurrence. */
export async function removeScheduleException(sessionId: string, day: number): Promise<void> {
  await syncedTransaction([db.scheduleExceptions], async (tx) => {
    await tx.del("scheduleExceptions", scheduleExceptionId(sessionId, day));
  });
}

/**
 * Remove every row in every table, including install preferences, so the next
 * launch behaves exactly like a first one. The caller is responsible for the
 * confirmations: this is the point of no return.
 */
export async function clearAllData(): Promise<void> {
  await assertSyncDisabled("resetting all data");
  await db.transaction("rw", db.tables, async () => {
    bypassCurrentSyncTransaction();
    await assertSyncDisabled("resetting all data");
    for (const table of db.tables) await table.clear();
    // Clear the tables first, then leave the marker that stops the next sync
    // enable from silently joining the old workspace.
    await db.settings.put({ key: "sync.resetPending", value: true });
  });
}

/** JSON backup of everything, used by export. */
export async function exportAll(): Promise<string> {
  const [
    items,
    projects,
    tags,
    focusSessions,
    goals,
    schedules,
    scheduleItems,
    scheduleBreaks,
    scheduleExceptions,
    workProjects,
    members,
    taskDependencies,
    habits,
    habitCheckins,
  ] = await Promise.all([
    db.items.toArray(),
    db.projects.toArray(),
    db.tags.toArray(),
    db.focusSessions.toArray(),
    db.goals.toArray(),
    db.schedules.toArray(),
    db.scheduleItems.toArray(),
    db.scheduleBreaks.toArray(),
    db.scheduleExceptions.toArray(),
    db.workProjects.toArray(),
    db.members.toArray(),
    db.taskDependencies.toArray(),
    db.habits.toArray(),
    db.habitCheckins.toArray(),
  ]);
  return JSON.stringify(
    {
      app: "tempo",
      version: 6,
      exportedAt: Date.now(),
      items,
      projects,
      tags,
      focusSessions,
      goals,
      schedules,
      scheduleItems,
      scheduleBreaks,
      scheduleExceptions,
      workProjects,
      members,
      taskDependencies,
      habits,
      habitCheckins,
    },
    null,
    2,
  );
}
