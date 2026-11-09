import type { Table } from "dexie";
import { db, journalBatch } from "../../db/db";
import {
  assessPeerHistory,
  type PeerHistoryAssessment,
} from "./compaction";
import {
  parseBatch,
  parseSnapshot,
  parseWorkspace,
  clockOf,
  compareClocks,
  incrementClock,
  joinClocks,
  mergeRows,
  remoteWins,
  sameRowData,
  repairReferences,
  rowKey,
  SyncFormatError,
  type MergeEntry,
  type MergeState,
} from "./merge";
import {
  SYNCED_TABLES,
  SYNCED_TABLE_SET,
  SYNC_FORMAT_VERSION,
  type JournalBatch,
  type JournalSnapshot,
  type SyncClock,
  type SyncCursorRow,
  type SyncDeviceMeta,
  type SyncDeviceRow,
  type SyncOp,
  type SyncOutboxRow,
  type SyncRow,
  type SyncStateRow,
  type SyncTable,
  type SyncFolder,
} from "./types";
import { permitCurrentSyncWrite } from "./writeGuard";

const CONFLICT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONFLICT_LIMIT = 100;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000, 300_000];
const MAX_SNAPSHOT_ROUNDS = 4;

export class SyncJoinRequiredError extends Error {
  readonly code = "sync-join-required";

  constructor(
    readonly deviceId: string,
    readonly snapshotSeq: number,
    readonly reason: "pending-edits" | "independent-history",
    message: string,
  ) {
    super(message);
    this.name = "SyncJoinRequiredError";
  }
}

export interface SyncEngineOptions {
  now?: () => number;
  /** Written to meta.json for diagnostics; never used for merge order. */
  platform?: string;
}

export interface FlushOptions {
  /** Ignore a pending retry delay. Used by an explicit "retry now" action. */
  force?: boolean;
}

export type FlushStatus = "disabled" | "idle" | "written" | "backoff" | "error";

export interface FlushResult {
  status: FlushStatus;
  /** Batches written during this call. */
  written: number;
  /** Every row still in the outbox, including rows waiting for a retry. */
  pending: number;
  error: string | null;
  retryAt: number | null;
}

export interface SyncPeerWait {
  deviceId: string;
  expectedSeq: number;
}

export interface SyncPeerBlock {
  deviceId: string;
  snapshotSeq: number;
  reason: SyncJoinRequiredError["reason"];
  message: string;
}

export interface SyncPeerError {
  deviceId: string | null;
  message: string;
}

export type PullStatus = "disabled" | "idle" | "applied" | "waiting" | "blocked" | "error";

export interface PullResult {
  status: PullStatus;
  appliedBatches: number;
  appliedSnapshots: number;
  conflicts: number;
  /** Concurrent edits combined field-by-field instead of overwritten. */
  merged: number;
  repairs: number;
  waiting: SyncPeerWait[];
  blocked: SyncPeerBlock[];
  errors: SyncPeerError[];
}

export interface SyncRunResult {
  flush: FlushResult;
  pull: PullResult;
}

interface ApplyOutcome {
  applied: number;
  ignored: number;
  conflicts: number;
  merged: number;
}

function syncedTables(): Table[] {
  return SYNCED_TABLES.map((table) => db.table(table));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function retryDelay(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1) - 1, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

function snapshotOps(snapshot: JournalSnapshot): SyncOp[] {
  const ops: SyncOp[] = [];
  for (const row of snapshot.rows) {
    ops.push({
      table: row.table,
      id: row.id,
      kind: "put",
      rev: row.rev,
      writer: row.writer,
      at: row.at,
      clock: row.clock,
      row: row.row,
    });
  }
  for (const row of snapshot.tombstones) {
    ops.push({
      table: row.table,
      id: row.id,
      kind: "del",
      rev: row.rev,
      writer: row.writer,
      at: row.at,
      clock: row.clock,
    });
  }
  return ops;
}

function emptyFlush(status: FlushStatus, pending: number): FlushResult {
  return { status, written: 0, pending, error: null, retryAt: null };
}

function emptyPull(status: PullStatus): PullResult {
  return {
    status,
    appliedBatches: 0,
    appliedSnapshots: 0,
    conflicts: 0,
    merged: 0,
    repairs: 0,
    waiting: [],
    blocked: [],
    errors: [],
  };
}

/**
 * The production journal worker. It owns the only write path from the local
 * Dexie outbox to a SyncFolder, and the only read path from that folder back
 * into the domain tables. Both directions are serialized: a caller may invoke
 * flush and pull from different places without interleaving their transactions.
 */
export class SyncEngine {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  private readonly platform: string;

  constructor(
    readonly folder: SyncFolder,
    options: SyncEngineOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.platform = options.platform ?? "unknown";
  }

  flush(options: FlushOptions = {}): Promise<FlushResult> {
    return this.enqueue(() => this.flushLocked(options));
  }

  pull(): Promise<PullResult> {
    return this.enqueue(() => this.pullLocked());
  }

  /** Flush local changes, then apply everything available from peers. */
  sync(options: FlushOptions = {}): Promise<SyncRunResult> {
    return this.enqueue(async () => ({
      flush: await this.flushLocked(options),
      pull: await this.pullLocked(),
    }));
  }

  /** Rewrite the advisory meta file after a pause or resume. */
  refreshMeta(): Promise<void> {
    return this.enqueue(async () => {
      const device = await db.syncDevice.get("local");
      if (device) await this.writeMeta(device);
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async flushLocked(options: FlushOptions = {}): Promise<FlushResult> {
    const device = await db.syncDevice.get("local");
    if (!device?.enabled || device.paused) {
      return emptyFlush("disabled", await db.syncOutbox.count());
    }

    try {
      await this.assertWorkspace(device);
    } catch (error) {
      return {
        ...emptyFlush("error", await db.syncOutbox.count()),
        error: messageOf(error),
      };
    }

    let written = 0;
    let pending = 0;

    for (;;) {
      const row = await db.syncOutbox.orderBy("seq").first();
      if (!row) break;

      const now = this.now();
      if (
        row.state === "error" &&
        !options.force &&
        (row.nextAttemptAt ?? 0) > now
      ) {
        return {
          status: "backoff",
          written,
          pending: await db.syncOutbox.count(),
          error: row.error ?? "That batch is waiting to retry.",
          retryAt: row.nextAttemptAt ?? null,
        };
      }

      try {
        await this.folder.writeBatch(
          device.deviceId,
          row.seq,
          JSON.stringify(row.batch, null, 2),
        );
      } catch (error) {
        const failure = await this.recordFlushFailure(row, messageOf(error));
        return {
          status: "error",
          written,
          pending: await db.syncOutbox.count(),
          error: failure.error,
          retryAt: failure.retryAt,
        };
      }

      try {
        await db.syncOutbox.delete(row.seq);
      } catch (error) {
        const failure = await this.recordFlushFailure(row, messageOf(error));
        return {
          status: "error",
          written,
          pending: await db.syncOutbox.count(),
          error: failure.error,
          retryAt: failure.retryAt,
        };
      }

      written += 1;
    }

    pending = await db.syncOutbox.count();
    if (written > 0) {
      const latest = await db.syncDevice.get("local");
      if (latest) await this.writeMeta(latest).catch(() => undefined);
    }

    return {
      status: written > 0 ? "written" : "idle",
      written,
      pending,
      error: null,
      retryAt: null,
    };
  }

  private async recordFlushFailure(
    row: SyncOutboxRow,
    message: string,
  ): Promise<{ error: string; retryAt: number }> {
    const now = this.now();
    const attempts = (row.attempts ?? 0) + 1;
    const retryAt = now + retryDelay(attempts);
    await db.syncOutbox.put({
      ...row,
      state: "error",
      error: message,
      attempts,
      nextAttemptAt: retryAt,
    });
    return { error: message, retryAt };
  }

  private async pullLocked(): Promise<PullResult> {
    const device = await db.syncDevice.get("local");
    if (!device?.enabled || device.paused) return emptyPull("disabled");

    try {
      await this.assertWorkspace(device);
    } catch (error) {
      return {
        ...emptyPull("error"),
        errors: [{ deviceId: null, message: messageOf(error) }],
      };
    }

    const now = this.now();
    const result = emptyPull("idle");
    await this.pruneConflicts(now).catch(() => undefined);

    const peers = (await this.folder.listDevices()).filter(
      (peer) => peer !== device.deviceId,
    );

    for (const peer of peers) {
      try {
        await this.pullPeer(device, peer, result, now);
      } catch (error) {
        if (error instanceof SyncJoinRequiredError) {
          result.blocked.push({
            deviceId: error.deviceId,
            snapshotSeq: error.snapshotSeq,
            reason: error.reason,
            message: error.message,
          });
        } else {
          result.errors.push({ deviceId: peer, message: messageOf(error) });
        }
      }
    }

    if (result.appliedBatches + result.appliedSnapshots > 0) {
      try {
        result.repairs = await this.repairReferences();
      } catch (error) {
        result.errors.push({
          deviceId: null,
          message: `Could not repair references: ${messageOf(error)}`,
        });
      }
      await this.pruneConflicts(this.now()).catch(() => undefined);
      const latest = await db.syncDevice.get("local");
      if (latest) await this.writeMeta(latest).catch(() => undefined);
    }

    if (result.errors.length > 0) result.status = "error";
    else if (result.blocked.length > 0) result.status = "blocked";
    else if (result.appliedBatches + result.appliedSnapshots > 0) result.status = "applied";
    else if (result.waiting.length > 0) result.status = "waiting";
    else result.status = "idle";

    return result;
  }

  private async pullPeer(
    device: SyncDeviceRow,
    peer: string,
    result: PullResult,
    now: number,
  ): Promise<void> {
    let cursorRow = await db.syncCursors.get(peer);
    let cursor = cursorRow?.lastSeq ?? 0;
    let batches = await this.folder.listBatches(peer);
    let snapshots = await this.folder.listSnapshots(peer);

    // A snapshot can raise several cursors, so a round may reveal more
    // contiguous batches. The bound only prevents a malformed folder from
    // spinning forever.
    for (let round = 0; round < MAX_SNAPSHOT_ROUNDS; round += 1) {
      let assessment: PeerHistoryAssessment = assessPeerHistory(
        cursor,
        batches,
        snapshots,
      );

      if (
        assessment.mode === "snapshot" &&
        assessment.snapshotSeq !== null &&
        cursorRow &&
        cursorRow.lastSnapshotSeq >= assessment.snapshotSeq
      ) {
        // The initial snapshot at seq 0 leaves the cursor at 0. Remember that
        // it was already applied so an idle folder is not re-read every cycle.
        if (batches.includes(1)) {
          assessment = { mode: "incremental", snapshotSeq: assessment.snapshotSeq };
        } else if (batches.length > 0) {
          result.waiting.push({ deviceId: peer, expectedSeq: 1 });
          return;
        } else {
          return;
        }
      }

      if (assessment.mode === "snapshot" && assessment.snapshotSeq !== null) {
        await this.assertCanBootstrap(device, peer, assessment.snapshotSeq);
        const beforeCursor = cursor;
        const text = await this.folder.readSnapshot(peer, assessment.snapshotSeq);
        if (text === null) return;

        const snapshot = parseSnapshot(text, device.workspaceId);
        if (snapshot.deviceId !== peer || snapshot.seq !== assessment.snapshotSeq) {
          throw new SyncFormatError(
            "A snapshot is stored under the wrong device or sequence.",
          );
        }

        const outcome = await this.applySnapshot(snapshot, now);
        result.appliedSnapshots += 1;
        result.conflicts += outcome.conflicts;
        result.merged += outcome.merged;

        cursorRow = await db.syncCursors.get(peer);
        cursor = cursorRow?.lastSeq ?? cursor;
        batches = await this.folder.listBatches(peer);
        snapshots = await this.folder.listSnapshots(peer);

        // An empty initial snapshot is a no-op. Do not re-read it forever.
        if (cursor === beforeCursor && !batches.includes(cursor + 1)) return;
        continue;
      }

      if (assessment.mode === "incremental") {
        let progressed = false;
        while (batches.includes(cursor + 1)) {
          const next = cursor + 1;
          const text = await this.folder.readBatch(peer, next);
          if (text === null) break;

          const batch = parseBatch(text, device.workspaceId);
          if (batch.deviceId !== peer || batch.seq !== next) {
            throw new SyncFormatError(
              "A batch is stored under the wrong device or sequence.",
            );
          }

          const outcome = await this.applyBatch(batch, now);
          if (!outcome) break;

          result.appliedBatches += 1;
          result.conflicts += outcome.conflicts;
        result.merged += outcome.merged;
          cursor = next;
          progressed = true;
        }

        if (progressed) {
          cursorRow = await db.syncCursors.get(peer);
          batches = await this.folder.listBatches(peer);
          snapshots = await this.folder.listSnapshots(peer);
          continue;
        }
        return;
      }

      if (assessment.mode === "gap") {
        result.waiting.push({ deviceId: peer, expectedSeq: cursor + 1 });
        return;
      }

      return;
    }
  }

  private async assertCanBootstrap(
    device: SyncDeviceRow,
    peer: string,
    snapshotSeq: number,
  ): Promise<void> {
    const pending = await db.syncOutbox.count();
    if (pending > 0) {
      throw new SyncJoinRequiredError(
        peer,
        snapshotSeq,
        "pending-edits",
        `This device has ${pending} local change${pending === 1 ? "" : "s"} waiting to upload. ` +
          "Choose replace-from-sync or start a new workspace before joining.",
      );
    }

    const current = await db.syncDevice.get("local");
    if ((current?.lastSeq ?? device.lastSeq) > 0) {
      throw new SyncJoinRequiredError(
        peer,
        snapshotSeq,
        "independent-history",
        "This device already has its own sync history. " +
          "Choose replace-from-sync or start a new workspace before joining.",
      );
    }
  }

  private async applyBatch(
    batch: JournalBatch,
    now: number,
  ): Promise<ApplyOutcome | null> {
    return db.transaction(
      "rw",
      [
        ...syncedTables(),
        db.syncState,
        db.syncCursors,
        db.syncConflicts,
        db.syncOutbox,
        db.syncDevice,
      ],
      async () => {
        const cursor = await db.syncCursors.get(batch.deviceId);
        const lastSeq = cursor?.lastSeq ?? 0;
        if (batch.seq <= lastSeq) return null;
        if (batch.seq !== lastSeq + 1) return null;

        const outcome = await this.applyOps(batch.ops, now);
        await db.syncCursors.put({
          deviceId: batch.deviceId,
          lastSeq: batch.seq,
          lastSnapshotSeq: cursor?.lastSnapshotSeq ?? 0,
          updatedAt: now,
        });
        return outcome;
      },
    );
  }

  private async applySnapshot(
    snapshot: JournalSnapshot,
    now: number,
  ): Promise<ApplyOutcome> {
    return db.transaction(
      "rw",
      [
        ...syncedTables(),
        db.syncState,
        db.syncCursors,
        db.syncConflicts,
        db.syncOutbox,
        db.syncDevice,
      ],
      async () => {
        const outcome = await this.applyOps(snapshotOps(snapshot), now);

        for (const [writer, seq] of Object.entries(snapshot.included)) {
          const current = await db.syncCursors.get(writer);
          const next: SyncCursorRow = {
            deviceId: writer,
            lastSeq: Math.max(current?.lastSeq ?? 0, seq),
            lastSnapshotSeq:
              writer === snapshot.deviceId
                ? Math.max(current?.lastSnapshotSeq ?? 0, snapshot.seq)
                : current?.lastSnapshotSeq ?? 0,
            updatedAt: now,
          };
          await db.syncCursors.put(next);
        }

        return outcome;
      },
    );
  }

  /**
   * Apply operations inside an existing Dexie transaction. The transaction
   * also contains the syncState and conflict writes, so an invalid row rolls
   * back the domain change and the cursor together.
   */
  private async applyOps(
    ops: readonly SyncOp[],
    now: number,
  ): Promise<ApplyOutcome> {
    let applied = 0;
    let ignored = 0;
    let conflicts = 0;
    let merged = 0;

    for (const op of ops) {
      if (!SYNCED_TABLE_SET.has(op.table)) {
        throw new SyncFormatError(`Unknown sync table: ${op.table}.`);
      }

      const key = rowKey(op.table, op.id);
      const local = await db.syncState.get(key);
      const localClock = local ? clockOf(local.rev, local.writer, local.clock) : undefined;
      const remoteClock = clockOf(op.rev, op.writer, op.clock);
      const relation = localClock ? compareClocks(remoteClock, localClock) : "after";
      const concurrent = relation === "concurrent";
      if (!remoteWins(op, local)) {
        ignored += 1;
        continue;
      }

      let handled = false;
      if (local && (local.rev !== op.rev || local.writer !== op.writer)) {
        const localRow = local.deleted
          ? undefined
          : ((await db.table(op.table).get(op.id)) as SyncRow | undefined);
        const localChanged =
          localRow != null &&
          (local.baseRow == null || !sameRowData(localRow, local.baseRow));

        if (op.kind === "put" && op.row && localRow && local.baseRow) {
          const combined = mergeRows(local.baseRow, localRow, op.row, "remote");

          if (concurrent && localChanged && !sameRowData(combined, op.row)) {
            // Different fields changed on each device: keep both and publish
            // one merged revision so snapshots and every peer agree.
            const device = await db.syncDevice.get("local");
            if (device) {
              await this.publishMerged(
                op.table,
                op.id,
                combined,
                Math.max(local.rev, op.rev) + 1,
                joinClocks(localClock, remoteClock),
                now,
                device,
              );
              merged += 1;
              handled = true;
            }
          } else if (concurrent && localChanged && !sameRowData(localRow, op.row)) {
            // Both sides changed the same field. The deterministic winner
            // applies, but the local value stays available to restore.
            await this.recordConflict(op, local, localRow, now);
            conflicts += 1;
          }
        } else if (
          concurrent &&
          localRow &&
          localChanged &&
          (op.kind === "del" || (op.row != null && !sameRowData(localRow, op.row)))
        ) {
          await this.recordConflict(op, local, localRow, now);
          conflicts += 1;
        }
      }

      if (handled) continue;

      permitCurrentSyncWrite();
      if (op.kind === "put") {
        if (!op.row) {
          throw new SyncFormatError("A put operation must carry the complete row.");
        }
        await db.table(op.table).put(op.row);
      } else {
        await db.table(op.table).delete(op.id);
      }

      const state: SyncStateRow = {
        key,
        table: op.table,
        id: op.id,
        rev: op.rev,
        writer: op.writer,
        deleted: op.kind === "del",
        at: op.at,
        clock: remoteClock,
        baseRow: op.kind === "put" ? op.row : undefined,
      };
      await db.syncState.put(state);
      applied += 1;
    }

    return { applied, ignored, conflicts, merged };
  }

  /** Keep a losing local row for manual restore after a true field collision. */
  private async recordConflict(
    op: SyncOp,
    local: SyncStateRow,
    lostRow: SyncRow,
    now: number,
  ): Promise<void> {
    await db.syncConflicts.add({
      table: op.table,
      rowId: op.id,
      at: now,
      localRev: local.rev,
      remoteRev: op.rev,
      winner: "remote",
      lostRow,
      expiresAt: now + CONFLICT_TTL_MS,
    });
  }

  /** Write a field-merged row and journal it so every replica converges. */
  private async publishMerged(
    table: SyncTable,
    id: string,
    merged: SyncRow,
    rev: number,
    joinedClock: SyncClock,
    now: number,
    device: SyncDeviceRow,
  ): Promise<void> {
    const row: SyncRow =
      "updatedAt" in merged ? { ...merged, updatedAt: now } : merged;
    const clock = incrementClock(joinedClock, device.deviceId);
    const op: SyncOp = {
      table,
      id,
      kind: "put",
      rev,
      writer: device.deviceId,
      at: now,
      clock,
      row,
    };

    permitCurrentSyncWrite();
    await db.table(table).put(row);
    await db.syncState.put({
      key: rowKey(table, id),
      table,
      id,
      rev,
      writer: device.deviceId,
      deleted: false,
      at: now,
      clock,
      baseRow: row,
    });

    const seq = device.lastSeq + 1;
    const batch = journalBatch({ ...device, lastSeq: seq }, [op], seq, now);
    await db.syncOutbox.add({ seq, batch, state: "pending", createdAt: now });
    await db.syncDevice.update("local", { lastSeq: seq });
  }

  /**
   * Rebuild the deterministic projection from local revisions, tombstone
   * dangling references, and persist only the changes. This creates no journal
   * operations; every device derives the same result.
   */
  private async repairReferences(): Promise<number> {
    return db.transaction("rw", [...syncedTables(), db.syncState], async () => {
      const stateRows = await db.syncState.toArray();
      const rowsByTable = new Map<SyncTable, Map<string, SyncRow>>();

      for (const table of SYNCED_TABLES) {
        const rows = (await db.table(table).toArray()) as SyncRow[];
        rowsByTable.set(table, new Map(rows.map((row) => [row.id, row])));
      }

      const entries = new Map<string, MergeEntry>();
      for (const row of stateRows) {
        const domain = rowsByTable.get(row.table)?.get(row.id) ?? null;
        if (!row.deleted && !domain) continue;
        entries.set(row.key, {
          table: row.table,
          id: row.id,
          rev: row.rev,
          writer: row.writer,
          deleted: row.deleted,
          at: row.at,
          clock: clockOf(row.rev, row.writer, row.clock),
          row: row.deleted ? null : domain,
        });
      }
      const state: MergeState = entries;
      const repaired = repairReferences(state);
      for (const change of repaired.changes) {
        const entry = repaired.state.get(rowKey(change.table, change.id));
        if (!entry) continue;

        if (change.action === "deleted") {
          permitCurrentSyncWrite();
          await db.table(change.table).delete(change.id);
          await db.syncState.put({
            key: rowKey(change.table, change.id),
            table: change.table,
            id: change.id,
            rev: entry.rev,
            writer: entry.writer,
            deleted: true,
            at: entry.at,
            clock: entry.clock,
          });
        } else if (entry.row) {
          permitCurrentSyncWrite();
          await db.table(change.table).put(entry.row);
        }
      }

      return repaired.changes.length;
    });
  }

  private async pruneConflicts(now: number): Promise<void> {
    await db.transaction("rw", db.syncConflicts, async () => {
      const expired = await db.syncConflicts
        .where("expiresAt")
        .belowOrEqual(now)
        .primaryKeys();
      if (expired.length > 0) await db.syncConflicts.bulkDelete(expired);

      const count = await db.syncConflicts.count();
      if (count > CONFLICT_LIMIT) {
        const keys = await db.syncConflicts
          .orderBy("at")
          .limit(count - CONFLICT_LIMIT)
          .primaryKeys();
        if (keys.length > 0) await db.syncConflicts.bulkDelete(keys);
      }
    });
  }

  private async assertWorkspace(device: SyncDeviceRow): Promise<void> {
    const text = await this.folder.readWorkspace();
    if (text === null) {
      throw new SyncFormatError("That sync folder has no workspace file.");
    }
    const workspace = parseWorkspace(text);
    if (workspace.workspaceId !== device.workspaceId) {
      throw new SyncFormatError("That sync folder belongs to another workspace.");
    }
  }

  /** Best effort: meta.json is advisory and must never block a batch write. */
  private async writeMeta(device: SyncDeviceRow): Promise<void> {
    const snapshots = await this.folder.listSnapshots(device.deviceId);
    const latestSnapshot =
      snapshots.length > 0 ? snapshots[snapshots.length - 1] : device.lastSnapshotSeq;
    const cursors = await db.syncCursors.toArray();
    const applied: Record<string, number> = {};
    for (const cursor of cursors) {
      if (cursor.deviceId !== device.deviceId) applied[cursor.deviceId] = cursor.lastSeq;
    }

    const meta: SyncDeviceMeta = {
      format: "tempo-sync-device",
      version: SYNC_FORMAT_VERSION,
      workspaceId: device.workspaceId,
      deviceId: device.deviceId,
      installId: device.installId,
      name: device.deviceName,
      platform: this.platform,
      lastSeq: device.lastSeq,
      latestSnapshot,
      applied,
      disabledAt: device.enabled && !device.paused ? null : this.now(),
      updatedAt: this.now(),
    };
    await this.folder.writeMeta(
      device.deviceId,
      JSON.stringify(meta, null, 2),
    );
  }
}
