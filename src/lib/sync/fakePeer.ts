import type { SyncFolder } from "./types";
import {
  applyBatch,
  applySnapshot,
  buildSnapshot,
  localDelete,
  localPut,
  mergeCursors,
  parseBatch,
  parseSnapshot,
  parseWorkspace,
  repairReferences,
  rowKey,
  SyncFormatError,
  type MergeConflict,
  type MergeEntry,
  type MergeState,
} from "./merge";
import {
  assessPeerHistory,
  planCompaction,
  type CompactionPlan,
} from "./compaction";
import {
  SYNC_DATA_VERSION,
  SYNC_FORMAT_VERSION,
  type JournalBatch,
  type SyncDeviceMeta,
  type SyncOp,
  type SyncRow,
  type SyncTable,
} from "./types";

export interface FakeTx {
  put(table: SyncTable, row: SyncRow): void;
  del(table: SyncTable, id: string): void;
}

export interface FakePeerOptions {
  /** Start the synthetic display clock at a known time for age/retention tests. */
  clock?: number;
  /**
   * Fault injection for the crash tests: runs after a batch file is written but
   * before the outbox row is removed, exactly where a process can die.
   */
  afterBatchWrite?: () => void | Promise<void>;
}

export interface FakePeerDump {
  state: Array<[string, MergeEntry]>;
  cursors: Array<[string, number]>;
  seq: number;
  outbox: JournalBatch[];
  conflicts: MergeConflict[];
  clock: number;
}

/** Raised when a compaction gap needs an explicit replace/new-workspace choice. */
export class SyncBootstrapError extends Error {
  readonly code = "bootstrap-choice-required";

  constructor(readonly deviceId: string) {
    super(
      "That device's early batches were compacted and this device has local changes. " +
        "Choose replace-from-sync or start a new workspace.",
    );
    this.name = "SyncBootstrapError";
  }
}

/**
 * A minimal device replica over a sync folder. Production writes go through
 * Dexie's `syncedTransaction`; this harness uses the same local revision rule
 * and batch format so the merger is exercised without IndexedDB.
 */
export class FakePeer {
  state: MergeState = new Map();
  cursors = new Map<string, number>();
  seq = 0;
  outbox: JournalBatch[] = [];
  conflicts: MergeConflict[] = [];
  private clock: number;
  private readonly options: FakePeerOptions;

  constructor(
    readonly folder: SyncFolder,
    readonly deviceId: string,
    readonly workspaceId: string,
    options: FakePeerOptions = {},
  ) {
    this.options = options;
    this.clock = options.clock ?? 1_000;
  }

  transact(fn: (tx: FakeTx) => void): JournalBatch | null {
    const ops: SyncOp[] = [];
    const tx: FakeTx = {
      put: (table, row) => {
        const result = localPut(this.state, this.deviceId, table, row, this.tick());
        this.state = result.state;
        ops.push(result.op);
      },
      del: (table, id) => {
        const result = localDelete(this.state, this.deviceId, table, id, this.tick());
        this.state = result.state;
        ops.push(result.op);
      },
    };
    fn(tx);
    if (ops.length === 0) return null;

    this.seq += 1;
    const batch: JournalBatch = {
      format: "tempo-sync-batch",
      version: SYNC_FORMAT_VERSION,
      workspaceId: this.workspaceId,
      deviceId: this.deviceId,
      seq: this.seq,
      createdAt: this.tick(),
      dataVersion: SYNC_DATA_VERSION,
      ops,
    };
    this.outbox.push(batch);
    return batch;
  }

  put(table: SyncTable, row: SyncRow): JournalBatch | null {
    return this.transact((tx) => tx.put(table, row));
  }

  del(table: SyncTable, id: string): JournalBatch | null {
    return this.transact((tx) => tx.del(table, id));
  }

  get(table: SyncTable, id: string): SyncRow | null {
    return this.state.get(rowKey(table, id))?.row ?? null;
  }

  /**
   * Persist the replica exactly as a crash would leave it. The outbox is part
   * of the dump, so a restarted device can retry an unwritten batch.
   */
  dump(): FakePeerDump {
    return structuredClone({
      state: [...this.state.entries()],
      cursors: [...this.cursors.entries()],
      seq: this.seq,
      outbox: this.outbox,
      conflicts: this.conflicts,
      clock: this.clock,
    });
  }

  static restore(
    folder: SyncFolder,
    deviceId: string,
    workspaceId: string,
    dump: FakePeerDump,
    options: FakePeerOptions = {},
  ): FakePeer {
    const peer = new FakePeer(folder, deviceId, workspaceId, options);
    peer.state = new Map(dump.state);
    peer.cursors = new Map(dump.cursors);
    peer.seq = dump.seq;
    peer.outbox = dump.outbox;
    peer.conflicts = dump.conflicts;
    peer.clock = dump.clock;
    return peer;
  }

  /** Write the next outbox batch, or return false when the outbox is empty. */
  async flushOne(): Promise<boolean> {
    const batch = this.outbox[0];
    if (!batch) return false;
    await this.folder.writeBatch(this.deviceId, batch.seq, JSON.stringify(batch, null, 2));
    if (this.options.afterBatchWrite) await this.options.afterBatchWrite();
    this.outbox.shift();
    return true;
  }

  async flush(): Promise<void> {
    await this.assertWorkspace();
    while (await this.flushOne()) {
      // Write in sequence order; a failed batch keeps the queue intact.
    }
    await this.writeMeta();
  }

  async pull(): Promise<void> {
    await this.assertWorkspace();
    const devices = await this.folder.listDevices();
    for (const peer of devices) {
      if (peer !== this.deviceId) await this.pullPeer(peer);
    }
    this.state = repairReferences(this.state).state;
  }

  /**
   * Write a snapshot at the current local sequence. Repeated calls at the same
   * sequence are a no-op, so a crash after the write can be retried safely.
   */
  async writeSnapshot(now = this.tick()): Promise<void> {
    await this.assertWorkspace();
    if (this.outbox.length > 0) {
      throw new SyncFormatError("Flush the outbox before writing a snapshot.");
    }
    const existing = await this.folder.readSnapshot(this.deviceId, this.seq);
    if (existing !== null) {
      parseSnapshot(existing, this.workspaceId);
      await this.writeMeta();
      return;
    }

    const included: Record<string, number> = {};
    for (const [deviceId, seq] of this.cursors) included[deviceId] = seq;
    included[this.deviceId] = this.seq;

    const snapshot = buildSnapshot(this.state, {
      workspaceId: this.workspaceId,
      deviceId: this.deviceId,
      seq: this.seq,
      included,
      createdAt: now,
    });
    await this.folder.writeSnapshot(
      this.deviceId,
      snapshot.seq,
      JSON.stringify(snapshot, null, 2),
    );
    await this.writeMeta();
  }

  /**
   * Apply the retention rules to this device's own folder. The snapshot is
   * written before anything is deleted; batches are pruned only when they are
   * covered and at least 30 days old.
   */
  async compact(now = Date.now()): Promise<CompactionPlan> {
    await this.assertWorkspace();

    const batches: Array<{ seq: number; createdAt: number }> = [];
    for (const seq of await this.folder.listBatches(this.deviceId)) {
      const text = await this.folder.readBatch(this.deviceId, seq);
      if (text === null) continue;
      const batch = parseBatch(text, this.workspaceId);
      if (batch.deviceId !== this.deviceId || batch.seq !== seq) {
        throw new SyncFormatError("A batch is stored under the wrong device or sequence.");
      }
      batches.push({ seq, createdAt: batch.createdAt });
    }

    const snapshots: Array<{ seq: number; createdAt: number }> = [];
    for (const seq of await this.folder.listSnapshots(this.deviceId)) {
      const text = await this.folder.readSnapshot(this.deviceId, seq);
      if (text === null) continue;
      const snapshot = parseSnapshot(text, this.workspaceId);
      if (snapshot.deviceId !== this.deviceId || snapshot.seq !== seq) {
        throw new SyncFormatError("A snapshot is stored under the wrong device or sequence.");
      }
      snapshots.push({ seq, createdAt: snapshot.createdAt });
    }

    const plan = planCompaction({
      lastSeq: this.seq,
      outboxCount: this.outbox.length,
      batches,
      snapshots,
      now,
    });

    if (plan.writeSnapshot) await this.writeSnapshot(now);
    for (const seq of plan.deleteSnapshots) {
      await this.folder.deleteSnapshot(this.deviceId, seq);
    }
    for (const seq of plan.deleteBatches) {
      await this.folder.deleteBatch(this.deviceId, seq);
    }
    await this.writeMeta();
    return plan;
  }

  private async pullPeer(peer: string): Promise<void> {
    let cursor = this.cursors.get(peer) ?? 0;
    let batches = await this.folder.listBatches(peer);

    // A loop because a snapshot can advance several cursors, after which more
    // contiguous batches may be readable in the same pull.
    for (let round = 0; round < 4; round += 1) {
      const snapshots = await this.folder.listSnapshots(peer);
      const assessment = assessPeerHistory(cursor, batches, snapshots);

      if (assessment.mode === "snapshot" && assessment.snapshotSeq !== null) {
        this.assertCanBootstrap(peer, cursor);
        const text = await this.folder.readSnapshot(peer, assessment.snapshotSeq);
        if (text === null) return;
        const snapshot = parseSnapshot(text, this.workspaceId);
        if (snapshot.deviceId !== peer || snapshot.seq !== assessment.snapshotSeq) {
          throw new SyncFormatError("A snapshot is stored under the wrong device or sequence.");
        }
        const beforeCursor = cursor;
        const result = applySnapshot(this.state, snapshot);
        this.state = result.state;
        this.conflicts.push(...result.conflicts);
        // A snapshot states what each writer's effects it contains. Raise
        // cursors; never lower one this device has already applied.
        this.cursors = mergeCursors(this.cursors, snapshot.included);
        cursor = this.cursors.get(peer) ?? cursor;
        batches = await this.folder.listBatches(peer);
        // An empty snapshot at cursor 0 is a no-op; do not apply it on every
        // round when there is no batch to move past it.
        if (cursor === beforeCursor && !batches.includes(cursor + 1)) return;
        continue;
      }

      if (assessment.mode === "incremental") {
        let progressed = false;
        while (batches.includes(cursor + 1)) {
          const next = cursor + 1;
          const text = await this.folder.readBatch(peer, next);
          if (text === null) break;
          const batch = parseBatch(text, this.workspaceId);
          if (batch.deviceId !== peer || batch.seq !== next) {
            throw new SyncFormatError("A batch is stored under the wrong device or sequence.");
          }
          const result = applyBatch(this.state, batch);
          this.state = result.state;
          this.conflicts.push(...result.conflicts);
          this.cursors.set(peer, next);
          cursor = next;
          progressed = true;
        }
        if (progressed) continue;
      }

      return;
    }
  }

  /**
   * Replacing an independent local history is never automatic. A fresh device
   * may bootstrap; a device with local batches or pending edits must choose.
   */
  private assertCanBootstrap(peer: string, cursor: number): void {
    const hasPendingLocalChanges = this.outbox.length > 0;
    const hasIndependentHistory = cursor === 0 && this.seq > 0;
    if (hasPendingLocalChanges || hasIndependentHistory) {
      throw new SyncBootstrapError(peer);
    }
  }

  private async assertWorkspace(): Promise<void> {
    const text = await this.folder.readWorkspace();
    if (text === null) throw new SyncFormatError("That sync folder has no workspace file.");
    const workspace = parseWorkspace(text);
    if (workspace.workspaceId !== this.workspaceId) {
      throw new SyncFormatError("That sync folder belongs to another workspace.");
    }
  }

  private async writeMeta(): Promise<void> {
    const snapshots = await this.folder.listSnapshots(this.deviceId);
    const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : 0;
    const meta: SyncDeviceMeta = {
      format: "tempo-sync-device",
      version: SYNC_FORMAT_VERSION,
      workspaceId: this.workspaceId,
      deviceId: this.deviceId,
      installId: `${this.deviceId}-install`,
      name: this.deviceId,
      platform: "test",
      lastSeq: this.seq,
      latestSnapshot,
      applied: Object.fromEntries(this.cursors),
      disabledAt: null,
      updatedAt: this.tick(),
    };
    await this.folder.writeMeta(this.deviceId, JSON.stringify(meta, null, 2));
  }

  private tick(): number {
    const value = this.clock;
    this.clock += 1;
    return value;
  }
}
