/**
 * Compaction policy for one device's journal folder. The rules are pure so the
 * fake adapter and the native adapter cannot drift: an op batch is only deleted
 * when a snapshot covers it and it is at least 30 days old. Peer acknowledgements
 * are deliberately not part of the decision; a dead device must not block
 * cleanup forever.
 */

export const SNAPSHOT_EVERY_BATCHES = 500;
export const SNAPSHOT_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
export const KEEP_SNAPSHOTS = 3;
export const BATCH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const SOFT_BATCH_FILE_TARGET = 2_000;

export interface CompactionFile {
  seq: number;
  createdAt: number;
}

export type SnapshotReason = "batch-count" | "age" | "file-pressure";

export interface CompactionInput {
  /** This device's highest committed batch sequence. */
  lastSeq: number;
  /** Snapshotting is deferred while local changes are not yet on disk. */
  outboxCount: number;
  /** This device's own op batches, not peers'. */
  batches: readonly CompactionFile[];
  /** This device's own snapshots. */
  snapshots: readonly CompactionFile[];
  now: number;
}

export interface CompactionPlan {
  writeSnapshot: boolean;
  snapshotReason: SnapshotReason | null;
  /** Own op files that are safe to remove. */
  deleteBatches: number[];
  /** Older snapshots beyond the retention count. */
  deleteSnapshots: number[];
  /** Own op files left after this plan runs. */
  fileCount: number;
  /** Highest snapshot sequence covering the batch folder after this plan. */
  snapshotCoveredSeq: number | null;
  warning: string | null;
}

export type PeerHistoryMode = "current" | "incremental" | "snapshot" | "gap";

export interface PeerHistoryAssessment {
  mode: PeerHistoryMode;
  /** The latest snapshot that can bootstrap this reader, when mode is snapshot. */
  snapshotSeq: number | null;
}

function bySeq<T extends CompactionFile>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => a.seq - b.seq);
}

function latest<T extends CompactionFile>(values: readonly T[]): T | null {
  return values.length > 0 ? values[values.length - 1] : null;
}

/**
 * Decide whether this device should snapshot and which files it may remove.
 * A pending outbox pauses the whole plan: writing a snapshot before a local
 * batch is durable would make the journal disagree with the snapshot.
 */
export function planCompaction(input: CompactionInput): CompactionPlan {
  const batches = bySeq(input.batches);
  const snapshots = bySeq(input.snapshots);
  const newestSnapshot = latest(snapshots);
  const pending = input.outboxCount > 0;

  const batchesSinceSnapshot = batches.filter(
    (batch) => batch.seq > (newestSnapshot?.seq ?? 0),
  ).length;
  const baselineAt =
    newestSnapshot?.createdAt ?? (batches.length > 0 ? batches[0].createdAt : input.now);
  const hasNewLocalBatches =
    batchesSinceSnapshot > 0 || (batches.length > 0 && input.lastSeq > (newestSnapshot?.seq ?? 0));

  let snapshotReason: SnapshotReason | null = null;
  if (!pending && batches.length > 0 && hasNewLocalBatches) {
    if (batches.length > SOFT_BATCH_FILE_TARGET) snapshotReason = "file-pressure";
    else if (batchesSinceSnapshot >= SNAPSHOT_EVERY_BATCHES) snapshotReason = "batch-count";
    else if (input.now - baselineAt >= SNAPSHOT_EVERY_MS) snapshotReason = "age";
  }

  const coverage = snapshotReason
    ? input.lastSeq
    : (newestSnapshot?.seq ?? null);

  const deleteBatches =
    !pending && coverage !== null
      ? batches
          .filter(
            (batch) =>
              batch.seq <= coverage && input.now - batch.createdAt >= BATCH_RETENTION_MS,
          )
          .map((batch) => batch.seq)
      : [];

  let retainedSnapshots = snapshots;
  if (!pending && snapshotReason) {
    const alreadyWritten = snapshots.some((snapshot) => snapshot.seq === input.lastSeq);
    retainedSnapshots = alreadyWritten
      ? snapshots
      : [...snapshots, { seq: input.lastSeq, createdAt: input.now }].sort(
          (a, b) => a.seq - b.seq,
        );
  }
  const deleteSnapshots = pending
    ? []
    : retainedSnapshots
        .slice(0, Math.max(0, retainedSnapshots.length - KEEP_SNAPSHOTS))
        .map((snapshot) => snapshot.seq);

  const fileCount = batches.length - deleteBatches.length;
  const warning =
    fileCount > SOFT_BATCH_FILE_TARGET
      ? `This device has ${fileCount} sync batches, above the 2,000-file target. ` +
        "Old batches stay until a snapshot covers them and they are 30 days old."
      : null;

  return {
    writeSnapshot: snapshotReason !== null,
    snapshotReason,
    deleteBatches,
    deleteSnapshots,
    fileCount,
    snapshotCoveredSeq: coverage,
    warning,
  };
}

/**
 * How a reader can advance from `cursor` using a peer's retained files.
 * A snapshot is used when the next batch is missing and a newer snapshot
 * exists. A gap with no snapshot is reported, never silently skipped.
 */
export function assessPeerHistory(
  cursor: number,
  batchSeqs: readonly number[],
  snapshotSeqs: readonly number[],
): PeerHistoryAssessment {
  const batches = [...new Set(batchSeqs)].sort((a, b) => a - b);
  const snapshots = [...new Set(snapshotSeqs)].sort((a, b) => a - b);
  const newestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  // A fresh reader always starts with the latest snapshot, even when batch 1
  // is still present: the snapshot may contain another writer's rows whose
  // early batches were compacted.
  if (cursor === 0 && newestSnapshot !== null) {
    return { mode: "snapshot", snapshotSeq: newestSnapshot };
  }
  if (batches.includes(cursor + 1)) {
    return { mode: "incremental", snapshotSeq: newestSnapshot };
  }
  if (newestSnapshot !== null && newestSnapshot > cursor) {
    return { mode: "snapshot", snapshotSeq: newestSnapshot };
  }
  if (cursor === 0 && batches.length === 0 && newestSnapshot === null) {
    return { mode: "current", snapshotSeq: null };
  }
  if (batches.length > 0 && batches[0] > cursor + 1) {
    return { mode: "gap", snapshotSeq: newestSnapshot };
  }
  return { mode: "current", snapshotSeq: newestSnapshot };
}
