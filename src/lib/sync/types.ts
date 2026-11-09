/**
 * The journal is platform-neutral. The native layer only supplies the folder;
 * everything below is ordinary JSON so the merge engine can run in a test.
 */
export const SYNC_FORMAT_VERSION = 1;
/** Mirrors the backup domain version. */
export const SYNC_DATA_VERSION = 6;
/** Oldest journal schema this build can still read. v5 predates exceptions. */
export const MIN_SYNC_DATA_VERSION = 5;

export const SYNCED_TABLES = [
  "items",
  "projects",
  "tags",
  "focusSessions",
  "goals",
  "schedules",
  "scheduleItems",
  "scheduleBreaks",
  "scheduleExceptions",
  "workProjects",
  "members",
  "taskDependencies",
  "habits",
  "habitCheckins",
] as const;

export type SyncTable = (typeof SYNCED_TABLES)[number];

export const SYNCED_TABLE_SET: ReadonlySet<string> = new Set(SYNCED_TABLES);

export const MAX_BATCH_OPS = 2_000;
export const MAX_BATCH_BYTES = 8 * 1024 * 1024;
/** Native and fake adapters refuse a journal file above this size. */
export const MAX_SYNC_FILE_BYTES = 64 * 1024 * 1024;

/** A device id becomes a path segment, so the native adapter validates it too. */
export const SYNC_DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidSyncDeviceId(value: string): boolean {
  return SYNC_DEVICE_ID_PATTERN.test(value);
}

export type SyncRow = Record<string, unknown> & { id: string };

/** Per-device causal counters for one row. Older journals omit this map. */
export type SyncClock = Record<string, number>;

export interface SyncOp {
  table: SyncTable;
  id: string;
  kind: "put" | "del";
  rev: number;
  writer: string;
  at: number;
  /** Present on new journals; old operations are interpreted from `rev`. */
  clock?: SyncClock;
  /** Present only for `put`; always the complete domain row. */
  row?: SyncRow;
}

export interface JournalBatch {
  format: "tempo-sync-batch";
  version: number;
  workspaceId: string;
  deviceId: string;
  seq: number;
  createdAt: number;
  dataVersion: number;
  ops: SyncOp[];
}

export interface SnapshotEntry {
  table: SyncTable;
  id: string;
  rev: number;
  writer: string;
  at: number;
  clock?: SyncClock;
  row: SyncRow;
}

export interface SnapshotTombstone {
  table: SyncTable;
  id: string;
  rev: number;
  writer: string;
  at: number;
  clock?: SyncClock;
}

export interface JournalSnapshot {
  format: "tempo-sync-snapshot";
  version: number;
  workspaceId: string;
  deviceId: string;
  seq: number;
  createdAt: number;
  dataVersion: number;
  /** Per-writer cursor map. Must contain `[deviceId]: seq`. */
  included: Record<string, number>;
  rows: SnapshotEntry[];
  tombstones: SnapshotTombstone[];
}

export interface WorkspaceFile {
  format: "tempo-sync-workspace";
  version: number;
  workspaceId: string;
  createdAt: number;
  createdBy: string;
}

export interface SyncDeviceMeta {
  format: "tempo-sync-device";
  version: number;
  workspaceId: string;
  deviceId: string;
  installId: string;
  name: string;
  platform: string;
  lastSeq: number;
  latestSnapshot: number;
  applied: Record<string, number>;
  disabledAt: number | null;
  updatedAt: number;
}

export interface SyncDeviceRow {
  key: "local";
  deviceId: string;
  /** Cached; the Keychain value is authoritative. */
  installId: string;
  workspaceId: string;
  deviceName: string;
  lastSeq: number;
  lastSnapshotSeq: number;
  enabled: boolean;
  /**
   * Sync is configured but access to the chosen folder is paused. Local edits
   * still enter the journal, so turning it back on writes the backlog.
   */
  paused?: boolean;
  folderKind: "folder";
  /** Absolute local path of the folder the user chose. */
  folderLabel: string | null;
}

export interface SyncStateRow {
  /** `${table}:${id}` */
  key: string;
  table: SyncTable;
  id: string;
  rev: number;
  writer: string;
  deleted: boolean;
  at: number;
  /** Causal history for this row; derived from `rev` for older state. */
  clock?: SyncClock;
  /**
   * Last commonly synced content for this row. Local only: it is the base of
   * the three-way merge when both devices edited the row concurrently.
   */
  baseRow?: SyncRow;
}

export interface SyncOutboxRow {
  seq: number;
  batch: JournalBatch;
  state: "pending" | "error";
  error?: string;
  /** Consecutive failed writes; drives the retry backoff. */
  attempts?: number;
  /** A failed row is not retried before this time unless forced. */
  nextAttemptAt?: number;
  createdAt: number;
}

export interface SyncCursorRow {
  deviceId: string;
  lastSeq: number;
  lastSnapshotSeq: number;
  updatedAt: number;
}

export interface SyncConflictRow {
  id?: number;
  table: SyncTable;
  rowId: string;
  at: number;
  localRev: number;
  remoteRev: number;
  winner: "local" | "remote";
  /** Local only, never written to the journal. */
  lostRow?: Record<string, unknown>;
  expiresAt: number;
}

/**
 * The only native surface the journal needs. JavaScript supplies the chosen
 * folder root; the platform layer constructs every journal path from validated
 * ids and sequence numbers.
 */
export interface SyncFolder {
  readWorkspace(): Promise<string | null>;
  /** Create-if-absent unless the confirmed-start-new path passes `replace`. */
  writeWorkspace(text: string, options?: { replace?: boolean }): Promise<void>;
  listDevices(): Promise<string[]>;
  readMeta(deviceId: string): Promise<string | null>;
  writeMeta(deviceId: string, text: string): Promise<void>;
  listBatches(deviceId: string): Promise<number[]>;
  readBatch(deviceId: string, seq: number): Promise<string | null>;
  /** Atomic and idempotent: identical bytes succeed, different bytes fail. */
  writeBatch(deviceId: string, seq: number, text: string): Promise<void>;
  deleteBatch(deviceId: string, seq: number): Promise<void>;
  listSnapshots(deviceId: string): Promise<number[]>;
  readSnapshot(deviceId: string, seq: number): Promise<string | null>;
  writeSnapshot(deviceId: string, seq: number, text: string): Promise<void>;
  deleteSnapshot(deviceId: string, seq: number): Promise<void>;
}
