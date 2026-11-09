import { assertSyncDisabled, db, exportAll } from "../db/db";
import { bypassCurrentSyncTransaction } from "./sync/writeGuard";
import type {
  FocusSession,
  Goal,
  GoalSpan,
  Habit,
  HabitCheckin,
  Item,
  ItemType,
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

/**
 * JSON backups are the only bridge between devices: everything else lives in
 * the local IndexedDB of one install. The shape is deliberately explicit and
 * versioned so a file written today can still be read after the schema moves.
 */
const APP = "tempo";
/**
 * v1 had no goals, v2 adds them, v3 adds fixed weekly schedules, v4 adds
 * work projects with their members and dependency links, v5 adds habits and
 * their check-ins, v6 adds one-off timetable exceptions. Older files are still
 * readable: a missing collection simply arrives empty.
 */
const SUPPORTED_VERSION = 6;
const ITEM_TYPES: ItemType[] = ["event", "task", "note"];
const GOAL_SPANS: GoalSpan[] = ["month", "year", "open"];

export interface BackupCounts {
  items: number;
  projects: number;
  tags: number;
  focusSessions: number;
  goals: number;
  schedules: number;
  workProjects: number;
  members: number;
  habits: number;
}

export interface Backup {
  app: typeof APP;
  version: number;
  exportedAt?: number;
  items: Item[];
  projects: Project[];
  tags: Tag[];
  focusSessions: FocusSession[];
  goals: Goal[];
  schedules: Schedule[];
  scheduleItems: ScheduleItem[];
  scheduleBreaks: ScheduleBreak[];
  scheduleExceptions: ScheduleException[];
  workProjects: WorkProject[];
  members: Member[];
  taskDependencies: TaskDependency[];
  habits: Habit[];
  habitCheckins: HabitCheckin[];
}

export class BackupError extends Error {}

export function backupCounts(data: {
  items: unknown[];
  projects: unknown[];
  tags: unknown[];
  focusSessions: unknown[];
  goals?: unknown[];
  schedules?: unknown[];
  workProjects?: unknown[];
  members?: unknown[];
  habits?: unknown[];
}): BackupCounts {
  return {
    items: data.items.length,
    projects: data.projects.length,
    tags: data.tags.length,
    focusSessions: data.focusSessions.length,
    goals: data.goals?.length ?? 0,
    schedules: data.schedules?.length ?? 0,
    workProjects: data.workProjects?.length ?? 0,
    members: data.members?.length ?? 0,
    habits: data.habits?.length ?? 0,
  };
}

export function describeCounts(counts: BackupCounts): string {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts = [plural(counts.items, "item")];
  if (counts.projects) parts.push(plural(counts.projects, "calendar"));
  if (counts.goals) parts.push(plural(counts.goals, "goal"));
  if (counts.schedules) parts.push(plural(counts.schedules, "schedule"));
  if (counts.workProjects) parts.push(plural(counts.workProjects, "project"));
  if (counts.members) parts.push(plural(counts.members, "member"));
  if (counts.habits) parts.push(plural(counts.habits, "habit"));
  if (counts.tags) parts.push(plural(counts.tags, "tag"));
  if (counts.focusSessions) parts.push(plural(counts.focusSessions, "focus session"));
  return parts.join(" · ");
}

/** Build the exact JSON that gets written to disk, plus what it contains. */
export async function buildBackup(): Promise<{ name: string; json: string; counts: BackupCounts }> {
  const json = await exportAll();
  const data = JSON.parse(json) as Backup;
  return {
    name: `tempo-backup-${new Date().toISOString().slice(0, 10)}.json`,
    json,
    counts: backupCounts(data),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Drop duplicate ids so re-importing a file can't collide inside one pass. */
function dedupe<T extends { id: string }>(rows: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

/**
 * Parse a chosen file into a backup, rejecting anything that is not one.
 * Every failure carries a sentence that can be shown to the user as-is.
 */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("That file isn't valid JSON.");
  }
  if (!isRecord(raw)) throw new BackupError("That file isn't a Tempo backup.");
  if (raw.app !== APP) {
    throw new BackupError("That file isn't a Tempo backup.");
  }
  const version = typeof raw.version === "number" ? raw.version : NaN;
  if (!Number.isFinite(version) || version < 1) {
    throw new BackupError("That backup is missing its version number.");
  }
  if (version > SUPPORTED_VERSION) {
    throw new BackupError("That backup came from a newer version of Tempo.");
  }

  const items = raw.items;
  if (!Array.isArray(items)) throw new BackupError("That backup has no items in it.");
  if (items.length > 0 && !items.every(isRecord)) {
    throw new BackupError("That backup's items are damaged.");
  }
  const broken = (items as Record<string, unknown>[]).find(
    (item) => typeof item.id !== "string" || !ITEM_TYPES.includes(item.type as ItemType),
  );
  if (broken) throw new BackupError("That backup's items are damaged.");

  const goalRows = raw.goals;
  if (goalRows !== undefined) {
    if (!Array.isArray(goalRows) || !goalRows.every(isRecord)) {
      throw new BackupError("That backup's goals are damaged.");
    }
    const badGoal = goalRows.find(
      (g) =>
        typeof g.id !== "string" ||
        typeof g.title !== "string" ||
        typeof g.start !== "number" ||
        !GOAL_SPANS.includes(g.span as GoalSpan),
    );
    if (badGoal) throw new BackupError("That backup's goals are damaged.");
  }

  const scheduleRows = raw.schedules;
  if (scheduleRows !== undefined) {
    if (!Array.isArray(scheduleRows) || !scheduleRows.every(isRecord)) {
      throw new BackupError("That backup's schedules are damaged.");
    }
    const bad = scheduleRows.find((s) => typeof s.id !== "string" || typeof s.name !== "string");
    if (bad) throw new BackupError("That backup's schedules are damaged.");
  }

  const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  const itemRows = dedupe(items as Item[]);
  const goals = dedupe(list<Goal>(goalRows));
  const projects = list<Project>(raw.projects).filter(
    (p) => isRecord(p) && typeof p.id === "string",
  );
  const tags = list<Tag>(raw.tags).filter((t) => isRecord(t) && typeof t.id === "string");
  const focusSessions = list<FocusSession>(raw.focusSessions).filter(
    (f) => isRecord(f) && typeof f.id === "string",
  );

  /**
   * Schedules arrive as three tables. Rows that point at a schedule the file
   * does not carry are dropped rather than restored as orphans.
   */
  const schedules = dedupe(list<Schedule>(scheduleRows)).filter(
    (s) => isRecord(s) && typeof s.id === "string" && typeof s.name === "string",
  );
  const known = new Set(schedules.map((s) => s.id));
  const rowsFor = <T extends { id: string; scheduleId: string }>(value: unknown): T[] =>
    dedupe(list<T>(value)).filter(
      (row) => isRecord(row) && typeof row.id === "string" && known.has(row.scheduleId),
    );
  const scheduleItems = rowsFor<ScheduleItem>(raw.scheduleItems);
  const scheduleBreaks = rowsFor<ScheduleBreak>(raw.scheduleBreaks);
  const sessionIds = new Set(scheduleItems.map((item) => item.id));
  const scheduleExceptions = rowsFor<ScheduleException>(raw.scheduleExceptions).filter(
    (row) =>
      typeof row.sessionId === "string" &&
      sessionIds.has(row.sessionId) &&
      (row.kind === "edit" || row.kind === "delete") &&
      typeof row.day === "number",
  );

  /**
   * Work projects arrive with their roster and dependency links. A damaged
   * collection is rejected, while rows that point outside the file are
   * dropped rather than restored as orphans.
   */
  const memberRows = raw.members;
  if (memberRows !== undefined) {
    if (!Array.isArray(memberRows) || !memberRows.every(isRecord)) {
      throw new BackupError("That backup's members are damaged.");
    }
    const bad = memberRows.find((m) => typeof m.id !== "string" || typeof m.name !== "string");
    if (bad) throw new BackupError("That backup's members are damaged.");
  }
  const members = dedupe(list<Member>(memberRows)).filter(
    (m) => isRecord(m) && typeof m.id === "string" && typeof m.name === "string",
  );
  const memberIds = new Set(members.map((m) => m.id));

  const workProjectRows = raw.workProjects;
  if (workProjectRows !== undefined) {
    if (!Array.isArray(workProjectRows) || !workProjectRows.every(isRecord)) {
      throw new BackupError("That backup's projects are damaged.");
    }
    const bad = workProjectRows.find(
      (p) =>
        typeof p.id !== "string" ||
        typeof p.name !== "string" ||
        (p.memberIds !== undefined &&
          (!Array.isArray(p.memberIds) || !p.memberIds.every((id) => typeof id === "string"))),
    );
    if (bad) throw new BackupError("That backup's projects are damaged.");
  }
  const workProjects = dedupe(list<WorkProject>(workProjectRows))
    .filter((p) => isRecord(p) && typeof p.id === "string" && typeof p.name === "string")
    .map((p) => ({
      ...p,
      // A member removed from the roster should not linger on the project.
      memberIds: (p.memberIds ?? []).filter((id) => memberIds.has(id)),
    }));
  const workProjectIds = new Set(workProjects.map((p) => p.id));
  const itemsById = new Map(itemRows.map((i) => [i.id, i]));

  const dependencyRows = raw.taskDependencies;
  if (dependencyRows !== undefined) {
    if (!Array.isArray(dependencyRows) || !dependencyRows.every(isRecord)) {
      throw new BackupError("That backup's task links are damaged.");
    }
    const bad = dependencyRows.find(
      (d) =>
        typeof d.id !== "string" ||
        typeof d.workProjectId !== "string" ||
        typeof d.predecessorId !== "string" ||
        typeof d.successorId !== "string" ||
        d.type !== "FS" ||
        typeof d.lagDays !== "number" ||
        !Number.isFinite(d.lagDays),
    );
    if (bad) throw new BackupError("That backup's task links are damaged.");
  }
  const linked = new Set<string>();
  const taskDependencies = dedupe(list<TaskDependency>(dependencyRows)).filter((d) => {
    if (!workProjectIds.has(d.workProjectId)) return false;
    const predecessor = itemsById.get(d.predecessorId);
    const successor = itemsById.get(d.successorId);
    if (!predecessor || !successor) return false;
    if (predecessor.workProjectId !== d.workProjectId) return false;
    if (successor.workProjectId !== d.workProjectId) return false;
    // The table has a unique pair index, so one pair may survive once only.
    const pair = `${d.predecessorId}\u0000${d.successorId}`;
    if (linked.has(pair)) return false;
    linked.add(pair);
    return true;
  });

  /**
   * Habits arrive with the days they were done. Check-ins that point at a
   * habit the file does not carry are dropped rather than restored as orphans.
   */
  const habitRows = raw.habits;
  if (habitRows !== undefined) {
    if (!Array.isArray(habitRows) || !habitRows.every(isRecord)) {
      throw new BackupError("That backup's habits are damaged.");
    }
    const bad = habitRows.find(
      (h) =>
        typeof h.id !== "string" ||
        typeof h.name !== "string" ||
        !Array.isArray(h.days) ||
        !h.days.every((day) => typeof day === "number"),
    );
    if (bad) throw new BackupError("That backup's habits are damaged.");
  }
  const habits = dedupe(list<Habit>(habitRows)).filter(
    (h) => isRecord(h) && typeof h.id === "string" && typeof h.name === "string",
  );
  const habitIds = new Set(habits.map((h) => h.id));
  const checkinRows = raw.habitCheckins;
  if (checkinRows !== undefined) {
    if (!Array.isArray(checkinRows) || !checkinRows.every(isRecord)) {
      throw new BackupError("That backup's habit history is damaged.");
    }
    const bad = checkinRows.find(
      (c) =>
        typeof c.id !== "string" ||
        typeof c.habitId !== "string" ||
        typeof c.day !== "number",
    );
    if (bad) throw new BackupError("That backup's habit history is damaged.");
  }
  const habitCheckins = dedupe(list<HabitCheckin>(checkinRows)).filter(
    (c) => isRecord(c) && typeof c.id === "string" && habitIds.has(c.habitId),
  );

  return {
    app: APP,
    version,
    exportedAt: typeof raw.exportedAt === "number" ? raw.exportedAt : undefined,
    items: itemRows,
    projects: dedupe(projects),
    tags: dedupe(tags),
    focusSessions: dedupe(focusSessions),
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
  };
}

export type RestoreMode = "replace" | "merge";

/**
 * Write a backup into the local database. `replace` is the restore path —
 * the device ends up exactly as the backup was — while `merge` keeps what is
 * already here and lets the file win on conflicts.
 */
export async function restoreBackup(backup: Backup, mode: RestoreMode): Promise<BackupCounts> {
  await assertSyncDisabled("restoring a backup");
  const counts = backupCounts(backup);
  await db.transaction(
    "rw",
    [
      db.items,
      db.projects,
      db.tags,
      db.focusSessions,
      db.goals,
      db.schedules,
      db.scheduleItems,
      db.scheduleBreaks,
      db.scheduleExceptions,
      db.workProjects,
      db.members,
      db.taskDependencies,
      db.habits,
      db.habitCheckins,
      db.settings,
      db.syncDevice,
      db.syncState,
      db.syncOutbox,
      db.syncCursors,
      db.syncConflicts,
    ],
    async () => {
      bypassCurrentSyncTransaction();
      // Re-check inside the transaction: another window could have enabled
      // sync between the first check and this write.
      await assertSyncDisabled("restoring a backup");
      if (mode === "replace") {
        await db.items.clear();
        await db.projects.clear();
        await db.tags.clear();
        await db.focusSessions.clear();
        await db.goals.clear();
        await db.schedules.clear();
        await db.scheduleItems.clear();
        await db.scheduleBreaks.clear();
        await db.scheduleExceptions.clear();
        await db.workProjects.clear();
        await db.members.clear();
        await db.taskDependencies.clear();
        await db.habits.clear();
        await db.habitCheckins.clear();
      }
      if (backup.projects.length) await db.projects.bulkPut(backup.projects);
      if (backup.tags.length) await db.tags.bulkPut(backup.tags);
      if (backup.members.length) await db.members.bulkPut(backup.members);
      if (backup.workProjects.length) await db.workProjects.bulkPut(backup.workProjects);
      if (backup.items.length) await db.items.bulkPut(backup.items);
      if (backup.focusSessions.length) await db.focusSessions.bulkPut(backup.focusSessions);
      if (backup.goals.length) await db.goals.bulkPut(backup.goals);
      if (backup.schedules.length) await db.schedules.bulkPut(backup.schedules);
      if (backup.scheduleItems.length) await db.scheduleItems.bulkPut(backup.scheduleItems);
      if (backup.scheduleBreaks.length) await db.scheduleBreaks.bulkPut(backup.scheduleBreaks);
      if (backup.scheduleExceptions.length) {
        await db.scheduleExceptions.bulkPut(backup.scheduleExceptions);
      }
      if (backup.taskDependencies.length) await db.taskDependencies.bulkPut(backup.taskDependencies);
      if (backup.habits.length) await db.habits.bulkPut(backup.habits);
      if (backup.habitCheckins.length) await db.habitCheckins.bulkPut(backup.habitCheckins);

      // A restore changes rows that may already have revisions; the old
      // journal cannot describe the result. Clear it locally and require an
      // explicit Start-new/Join choice the next time sync is enabled.
      await db.syncDevice.clear();
      await db.syncState.clear();
      await db.syncOutbox.clear();
      await db.syncCursors.clear();
      await db.syncConflicts.clear();
      await db.settings.put({ key: "sync.resetPending", value: true });
    },
  );
  return counts;
}
