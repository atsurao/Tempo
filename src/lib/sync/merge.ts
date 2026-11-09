import {
  MAX_BATCH_BYTES,
  MAX_BATCH_OPS,
  MIN_SYNC_DATA_VERSION,
  SYNC_DATA_VERSION,
  SYNC_FORMAT_VERSION,
  SYNCED_TABLE_SET,
  type JournalBatch,
  type JournalSnapshot,
  type SnapshotEntry,
  type SnapshotTombstone,
  type SyncClock,
  type SyncOp,
  type SyncRow,
  type SyncTable,
  type WorkspaceFile,
} from "./types";

export class SyncFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncFormatError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new SyncFormatError(`That sync ${label} is not an object.`);
  return value;
}

function asText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SyncFormatError(`That sync ${label} is missing.`);
  }
  return value;
}

function asInt(value: unknown, label: string, min: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) {
    throw new SyncFormatError(`That sync ${label} is invalid.`);
  }
  return value as number;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SyncFormatError(`That sync ${label} is invalid.`);
  }
  return value;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new SyncFormatError(`That sync ${label} is not a list.`);
  return value;
}

function readClock(value: unknown, writer: string): SyncClock | undefined {
  if (value === undefined) return undefined;
  const raw = asRecord(value, "clock");
  const entries = Object.entries(raw);
  if (entries.length === 0) throw new SyncFormatError("That sync clock is empty.");
  const clock: SyncClock = {};
  for (const [deviceId, count] of entries) {
    if (deviceId.trim() === "") throw new SyncFormatError("That sync clock has an empty device id.");
    clock[deviceId] = asInt(count, "clock count", 1);
  }
  if (clock[writer] === undefined) {
    throw new SyncFormatError("That sync clock does not include its writer.");
  }
  return clock;
}

function asTable(value: unknown): SyncTable {
  const table = asText(value, "table");
  if (!SYNCED_TABLE_SET.has(table)) {
    throw new SyncFormatError(`That sync batch uses an unknown table: ${table}.`);
  }
  return table as SyncTable;
}

function checkFormat(value: Record<string, unknown>, expected: string): number {
  if (value.format !== expected) throw new SyncFormatError("That sync file has the wrong format.");
  const version = asInt(value.version, "format version", 1);
  if (version > SYNC_FORMAT_VERSION) {
    throw new SyncFormatError("That sync file needs a newer version of Tempo.");
  }
  if (version !== SYNC_FORMAT_VERSION) {
    throw new SyncFormatError("That sync file uses an unsupported format.");
  }
  return version;
}

function checkDataVersion(value: unknown, expected: number): number {
  const dataVersion = asInt(value, "data version", 1);
  if (dataVersion > expected) {
    throw new SyncFormatError("That sync file needs a newer version of Tempo.");
  }
  if (dataVersion < MIN_SYNC_DATA_VERSION) {
    throw new SyncFormatError("That sync file uses an unsupported data version.");
  }
  return dataVersion;
}

function checkWorkspace(value: unknown, expected?: string): string {
  const workspaceId = asText(value, "workspace id");
  if (expected !== undefined && workspaceId !== expected) {
    throw new SyncFormatError("That sync file belongs to another workspace.");
  }
  return workspaceId;
}

function readOp(raw: unknown, deviceId: string): SyncOp {
  const value = asRecord(raw, "operation");
  const table = asTable(value.table);
  const id = asText(value.id, "row id");
  const kind = value.kind;
  if (kind !== "put" && kind !== "del") {
    throw new SyncFormatError("That sync operation has an unknown kind.");
  }
  const rev = asInt(value.rev, "revision", 1);
  const writer = asText(value.writer, "writer");
  if (writer !== deviceId) {
    throw new SyncFormatError("That sync batch contains an operation from another device.");
  }
  const at = asNumber(value.at, "timestamp");
  const clock = readClock(value.clock, writer);

  if (kind === "put") {
    const row = asRecord(value.row, "row");
    if (asText(row.id, "row id") !== id) {
      throw new SyncFormatError("That sync operation's row does not match its id.");
    }
    return { table, id, kind, rev, writer, at, clock, row: row as SyncRow };
  }

  if ("row" in value && value.row !== undefined) {
    throw new SyncFormatError("A delete operation must not carry a row.");
  }
  return { table, id, kind, rev, writer, at, clock };
}

export function validateBatch(raw: unknown, expectedWorkspaceId?: string): JournalBatch {
  const value = asRecord(raw, "batch");
  const version = checkFormat(value, "tempo-sync-batch");
  const workspaceId = checkWorkspace(value.workspaceId, expectedWorkspaceId);
  const dataVersion = checkDataVersion(value.dataVersion, SYNC_DATA_VERSION);
  const deviceId = asText(value.deviceId, "device id");
  const seq = asInt(value.seq, "sequence", 1);
  const createdAt = asNumber(value.createdAt, "timestamp");
  const rows = asArray(value.ops, "batch operations");
  if (rows.length === 0) throw new SyncFormatError("That sync batch is empty.");
  if (rows.length > MAX_BATCH_OPS) {
    throw new SyncFormatError("That sync batch is larger than this version supports.");
  }
  return {
    format: "tempo-sync-batch",
    version,
    workspaceId,
    deviceId,
    seq,
    createdAt,
    dataVersion,
    ops: rows.map((op) => readOp(op, deviceId)),
  };
}

export function parseBatch(text: string, expectedWorkspaceId?: string): JournalBatch {
  if (new TextEncoder().encode(text).byteLength > MAX_BATCH_BYTES) {
    throw new SyncFormatError("That sync batch is larger than this version supports.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SyncFormatError("That sync batch is not valid JSON.");
  }
  return validateBatch(raw, expectedWorkspaceId);
}

function readSnapshotEntry(raw: unknown): SnapshotEntry {
  const value = asRecord(raw, "snapshot row");
  const table = asTable(value.table);
  const id = asText(value.id, "row id");
  const rev = asInt(value.rev, "revision", 1);
  const writer = asText(value.writer, "writer");
  const at = asNumber(value.at, "timestamp");
  const clock = readClock(value.clock, writer);
  const row = asRecord(value.row, "row");
  if (asText(row.id, "row id") !== id) {
    throw new SyncFormatError("That snapshot row does not match its id.");
  }
  return { table, id, rev, writer, at, clock, row: row as SyncRow };
}

function readTombstone(raw: unknown): SnapshotTombstone {
  const value = asRecord(raw, "snapshot tombstone");
  const table = asTable(value.table);
  const id = asText(value.id, "row id");
  const rev = asInt(value.rev, "revision", 1);
  const writer = asText(value.writer, "writer");
  const at = asNumber(value.at, "timestamp");
  const clock = readClock(value.clock, writer);
  if ("row" in value && value.row !== undefined) {
    throw new SyncFormatError("A snapshot tombstone must not carry a row.");
  }
  return { table, id, rev, writer, at, clock };
}

export function validateSnapshot(raw: unknown, expectedWorkspaceId?: string): JournalSnapshot {
  const value = asRecord(raw, "snapshot");
  const version = checkFormat(value, "tempo-sync-snapshot");
  const workspaceId = checkWorkspace(value.workspaceId, expectedWorkspaceId);
  const dataVersion = checkDataVersion(value.dataVersion, SYNC_DATA_VERSION);
  const deviceId = asText(value.deviceId, "device id");
  const seq = asInt(value.seq, "sequence", 0);
  const createdAt = asNumber(value.createdAt, "timestamp");

  const includedRaw = asRecord(value.included, "snapshot included map");
  const included: Record<string, number> = {};
  for (const [key, cursor] of Object.entries(includedRaw)) {
    if (key.trim() === "") throw new SyncFormatError("That snapshot has an empty writer id.");
    included[key] = asInt(cursor, "snapshot cursor", 0);
  }
  if (included[deviceId] !== seq) {
    throw new SyncFormatError("That snapshot does not cover its own sequence.");
  }

  const seen = new Set<string>();
  const rows = asArray(value.rows, "snapshot rows").map((entry) => {
    const row = readSnapshotEntry(entry);
    const key = `${row.table}:${row.id}`;
    if (seen.has(key)) throw new SyncFormatError("That snapshot has duplicate rows.");
    seen.add(key);
    return row;
  });
  const tombstones = asArray(value.tombstones, "snapshot tombstones").map((entry) => {
    const row = readTombstone(entry);
    const key = `${row.table}:${row.id}`;
    if (seen.has(key)) throw new SyncFormatError("That snapshot has duplicate rows.");
    seen.add(key);
    return row;
  });

  return {
    format: "tempo-sync-snapshot",
    version,
    workspaceId,
    deviceId,
    seq,
    createdAt,
    dataVersion,
    included,
    rows,
    tombstones,
  };
}

export function parseSnapshot(text: string, expectedWorkspaceId?: string): JournalSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SyncFormatError("That sync snapshot is not valid JSON.");
  }
  return validateSnapshot(raw, expectedWorkspaceId);
}

export function validateWorkspace(raw: unknown): WorkspaceFile {
  const value = asRecord(raw, "workspace");
  const version = checkFormat(value, "tempo-sync-workspace");
  return {
    format: "tempo-sync-workspace",
    version,
    workspaceId: checkWorkspace(value.workspaceId),
    createdAt: asNumber(value.createdAt, "timestamp"),
    createdBy: asText(value.createdBy, "creator"),
  };
}

export function parseWorkspace(text: string): WorkspaceFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SyncFormatError("That sync workspace file is not valid JSON.");
  }
  return validateWorkspace(raw);
}

/** One materialized row, including the tombstone state that protects deletes. */
export interface MergeEntry {
  table: SyncTable;
  id: string;
  rev: number;
  writer: string;
  deleted: boolean;
  at: number;
  clock: SyncClock;
  row: SyncRow | null;
}

export type MergeState = ReadonlyMap<string, MergeEntry>;

export interface MergeConflict {
  table: SyncTable;
  rowId: string;
  at: number;
  localRev: number;
  remoteRev: number;
  winner: "remote";
  /** Absent when the loser was already a tombstone. */
  lostRow?: SyncRow;
}

export interface ApplyResult {
  state: MergeState;
  status: "applied" | "ignored";
  conflict?: MergeConflict;
}

export interface BatchApplyResult {
  state: MergeState;
  applied: number;
  ignored: number;
  conflicts: MergeConflict[];
}

export interface LocalWriteResult {
  state: MergeState;
  op: SyncOp;
}

export interface RepairChange {
  table: SyncTable;
  id: string;
  action: "cleared" | "removed-ids" | "deleted";
  field?: string;
}

export interface RepairResult {
  state: MergeState;
  changes: RepairChange[];
}

export function rowKey(table: SyncTable, id: string): string {
  return `${table}:${id}`;
}

export type ClockRelation = "before" | "after" | "equal" | "concurrent";

/** Old revisions become a one-device clock; new revisions carry the full map. */
export function clockOf(rev: number, writer: string, clock?: SyncClock): SyncClock {
  return clock && Object.keys(clock).length > 0 ? { ...clock } : { [writer]: rev };
}

export function joinClocks(a: SyncClock | undefined, b: SyncClock | undefined): SyncClock {
  const out: SyncClock = { ...a };
  for (const [deviceId, count] of Object.entries(b ?? {})) {
    out[deviceId] = Math.max(out[deviceId] ?? 0, count);
  }
  return out;
}

export function incrementClock(clock: SyncClock | undefined, writer: string): SyncClock {
  const out: SyncClock = { ...clock };
  out[writer] = (out[writer] ?? 0) + 1;
  return out;
}

export function compareClocks(remote: SyncClock, local: SyncClock): ClockRelation {
  let remoteAhead = false;
  let localAhead = false;
  for (const deviceId of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    const theirs = remote[deviceId] ?? 0;
    const ours = local[deviceId] ?? 0;
    if (theirs > ours) remoteAhead = true;
    else if (ours > theirs) localAhead = true;
  }
  if (remoteAhead && localAhead) return "concurrent";
  if (remoteAhead) return "after";
  if (localAhead) return "before";
  return "equal";
}

/**
 * Record-level LWW. A causally later clock wins. Concurrent edits fall back to
 * the Lamport revision and writer id, so every device picks the same winner
 * without consulting a wall clock.
 */
export function remoteWins(
  op: Pick<SyncOp, "rev" | "writer"> & { clock?: SyncClock },
  local:
    | (Pick<MergeEntry, "rev" | "writer"> & { clock?: SyncClock })
    | undefined,
): boolean {
  if (!local) return true;
  const relation = compareClocks(
    clockOf(op.rev, op.writer, op.clock),
    clockOf(local.rev, local.writer, local.clock),
  );
  if (relation === "after") return true;
  if (relation === "before" || relation === "equal") return false;
  if (op.rev !== local.rev) return op.rev > local.rev;
  if (op.writer !== local.writer) return op.writer > local.writer;
  return false;
}

/** Metadata that changes on every write and never decides a field merge. */
const MERGE_META_FIELDS = new Set(["updatedAt"]);

/** Fields whose values are sets: concurrent additions and removals combine. */
const MERGE_SET_FIELDS = new Set([
  "tagIds",
  "assigneeIds",
  "memberIds",
  "days",
  "workingDays",
]);

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]),
    );
  }
  return false;
}

/** Compare row content, ignoring the timestamp every write bumps. */
export function sameRowData(a: SyncRow, b: SyncRow): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (MERGE_META_FIELDS.has(key)) continue;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function compareSetValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function mergeSets(base: unknown[], local: unknown[], remote: unknown[]): unknown[] {
  const baseSet = new Set(base);
  const localSet = new Set(local);
  const remoteSet = new Set(remote);
  const kept: unknown[] = [];
  for (const value of new Set([...local, ...remote])) {
    const was = baseSet.has(value);
    const mine = localSet.has(value);
    const theirs = remoteSet.has(value);
    // Keep what both sides still have, plus anything either side added. A
    // removal on one side wins only when the other side did not add it back.
    if ((mine && theirs) || (mine && !was) || (theirs && !was)) kept.push(value);
  }
  return kept.sort(compareSetValues);
}

/**
 * Field-level three-way merge. A field changed on one side only takes that
 * side's value; a field both sides changed takes the deterministic winner.
 * Set-valued fields combine concurrent tag, member and weekday edits.
 */
export function mergeRows(
  base: SyncRow | undefined,
  local: SyncRow,
  remote: SyncRow,
  winner: "local" | "remote",
): SyncRow {
  const keys = new Set([
    ...Object.keys(local),
    ...Object.keys(remote),
    ...(base ? Object.keys(base) : []),
  ]);
  const merged: SyncRow = { id: local.id };

  for (const key of keys) {
    if (key === "id") continue;
    const localValue = local[key];
    const remoteValue = remote[key];
    const baseValue = base?.[key];
    let value: unknown;

    if (deepEqual(localValue, remoteValue)) {
      value = localValue;
    } else if (base && deepEqual(localValue, baseValue)) {
      value = remoteValue;
    } else if (base && deepEqual(remoteValue, baseValue)) {
      value = localValue;
    } else if (
      base &&
      MERGE_SET_FIELDS.has(key) &&
      Array.isArray(localValue) &&
      Array.isArray(remoteValue) &&
      Array.isArray(baseValue)
    ) {
      value = mergeSets(baseValue, localValue, remoteValue);
    } else {
      value = winner === "remote" ? remoteValue : localValue;
    }

    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function entryFor(op: SyncOp): MergeEntry {
  if (op.kind === "put" && (!op.row || op.row.id !== op.id)) {
    throw new SyncFormatError("A put operation must carry the complete row.");
  }
  return {
    table: op.table,
    id: op.id,
    rev: op.rev,
    writer: op.writer,
    deleted: op.kind === "del",
    at: op.at,
    clock: clockOf(op.rev, op.writer, op.clock),
    row: op.kind === "put" ? (op.row ?? null) : null,
  };
}

function applyInPlace(
  state: Map<string, MergeEntry>,
  op: SyncOp,
  conflicts: MergeConflict[],
): "applied" | "ignored" {
  const key = rowKey(op.table, op.id);
  const local = state.get(key);
  const relation = local
    ? compareClocks(
        clockOf(op.rev, op.writer, op.clock),
        clockOf(local.rev, local.writer, local.clock),
      )
    : "after";
  if (!remoteWins(op, local)) return "ignored";

  if (local && relation === "concurrent") {
    conflicts.push({
      table: op.table,
      rowId: op.id,
      at: op.at,
      localRev: local.rev,
      remoteRev: op.rev,
      winner: "remote",
      lostRow: local.deleted || !local.row ? undefined : local.row,
    });
  }
  // Adopt the winning revision's clock. Joining a concurrent loser would
  // make replicas keep different histories for the same winning content, so
  // their next edits could look concurrent again. When both sides changed
  // different fields, the engine republishes the combined row as a new causal
  // revision instead.
  state.set(key, entryFor(op));
  return "applied";
}

export function applyOp(state: MergeState, op: SyncOp): ApplyResult {
  const next = new Map(state);
  const conflicts: MergeConflict[] = [];
  const status = applyInPlace(next, op, conflicts);
  return { state: next, status, conflict: conflicts[0] };
}

/** Apply a structurally validated batch to a copy of the state. */
export function applyBatch(state: MergeState, batch: JournalBatch): BatchApplyResult {
  const checked = validateBatch(batch);
  const next = new Map(state);
  const conflicts: MergeConflict[] = [];
  let applied = 0;
  let ignored = 0;
  for (const op of checked.ops) {
    if (applyInPlace(next, op, conflicts) === "applied") applied += 1;
    else ignored += 1;
  }
  return { state: next, applied, ignored, conflicts };
}

/** A snapshot is a merge source: every entry follows the same revision rules. */
export function applySnapshot(state: MergeState, snapshot: JournalSnapshot): BatchApplyResult {
  const checked = validateSnapshot(snapshot);
  const next = new Map(state);
  const conflicts: MergeConflict[] = [];
  let applied = 0;
  let ignored = 0;

  for (const row of checked.rows) {
    const op: SyncOp = {
      table: row.table,
      id: row.id,
      kind: "put",
      rev: row.rev,
      writer: row.writer,
      at: row.at,
      clock: row.clock,
      row: row.row,
    };
    if (applyInPlace(next, op, conflicts) === "applied") applied += 1;
    else ignored += 1;
  }
  for (const row of checked.tombstones) {
    const op: SyncOp = {
      table: row.table,
      id: row.id,
      kind: "del",
      rev: row.rev,
      writer: row.writer,
      at: row.at,
      clock: row.clock,
    };
    if (applyInPlace(next, op, conflicts) === "applied") applied += 1;
    else ignored += 1;
  }
  return { state: next, applied, ignored, conflicts };
}

export function localPut(
  state: MergeState,
  writer: string,
  table: SyncTable,
  row: SyncRow,
  at: number,
): LocalWriteResult {
  if (!SYNCED_TABLE_SET.has(table)) throw new SyncFormatError(`Unknown sync table: ${table}.`);
  if (typeof row.id !== "string" || row.id === "") {
    throw new SyncFormatError("A synced row needs an id.");
  }
  const local = state.get(rowKey(table, row.id));
  const op: SyncOp = {
    table,
    id: row.id,
    kind: "put",
    rev: (local?.rev ?? 0) + 1,
    writer,
    at,
    clock: incrementClock(local ? clockOf(local.rev, local.writer, local.clock) : undefined, writer),
    row,
  };
  const next = new Map(state);
  next.set(rowKey(table, row.id), entryFor(op));
  return { state: next, op };
}

export function localDelete(
  state: MergeState,
  writer: string,
  table: SyncTable,
  id: string,
  at: number,
): LocalWriteResult {
  if (!SYNCED_TABLE_SET.has(table)) throw new SyncFormatError(`Unknown sync table: ${table}.`);
  const local = state.get(rowKey(table, id));
  const op: SyncOp = {
    table,
    id,
    kind: "del",
    rev: (local?.rev ?? 0) + 1,
    writer,
    at,
    clock: incrementClock(local ? clockOf(local.rev, local.writer, local.clock) : undefined, writer),
  };
  const next = new Map(state);
  next.set(rowKey(table, id), entryFor(op));
  return { state: next, op };
}

export interface BuildSnapshotOptions {
  workspaceId: string;
  deviceId: string;
  seq: number;
  included: Record<string, number>;
  dataVersion?: number;
  createdAt?: number;
}

export function buildSnapshot(state: MergeState, options: BuildSnapshotOptions): JournalSnapshot {
  if (!Number.isSafeInteger(options.seq) || options.seq < 0) {
    throw new SyncFormatError("A snapshot sequence is invalid.");
  }
  for (const [deviceId, cursor] of Object.entries(options.included)) {
    if (deviceId.trim() === "" || !Number.isSafeInteger(cursor) || cursor < 0) {
      throw new SyncFormatError("A snapshot cursor is invalid.");
    }
  }
  if (options.included[options.deviceId] !== options.seq) {
    throw new SyncFormatError("A snapshot's included map must cover its own sequence.");
  }
  const rows: SnapshotEntry[] = [];
  const tombstones: SnapshotTombstone[] = [];
  const entries = [...state.values()].sort(
    (a, b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id),
  );
  for (const entry of entries) {
    if (entry.deleted) {
      tombstones.push({
        table: entry.table,
        id: entry.id,
        rev: entry.rev,
        writer: entry.writer,
        at: entry.at,
        clock: entry.clock,
      });
    } else {
      if (!entry.row) throw new SyncFormatError("A live sync row has no data.");
      rows.push({
        table: entry.table,
        id: entry.id,
        rev: entry.rev,
        writer: entry.writer,
        at: entry.at,
        clock: entry.clock,
        row: entry.row,
      });
    }
  }
  return {
    format: "tempo-sync-snapshot",
    version: SYNC_FORMAT_VERSION,
    workspaceId: options.workspaceId,
    deviceId: options.deviceId,
    seq: options.seq,
    createdAt: options.createdAt ?? Date.now(),
    dataVersion: options.dataVersion ?? SYNC_DATA_VERSION,
    included: { ...options.included },
    rows,
    tombstones,
  };
}

/** Raise cursors only; a snapshot must never move a device backwards. */
export function mergeCursors(
  current: ReadonlyMap<string, number>,
  included: Record<string, number>,
): Map<string, number> {
  const next = new Map(current);
  for (const [deviceId, seq] of Object.entries(included)) {
    next.set(deviceId, Math.max(next.get(deviceId) ?? 0, seq));
  }
  return next;
}

function deletedIds(state: MergeState, table: SyncTable): Set<string> {
  const ids = new Set<string>();
  for (const entry of state.values()) {
    if (entry.table === table && entry.deleted) ids.add(entry.id);
  }
  return ids;
}

function clearDeadRef(row: SyncRow, field: string, dead: Set<string>): SyncRow | null {
  const value = row[field];
  if (typeof value !== "string" || !dead.has(value)) return null;
  return { ...row, [field]: null };
}

function withoutDeadIds(value: unknown, dead: Set<string>): string[] | null {
  if (!Array.isArray(value) || dead.size === 0) return null;
  let changed = false;
  const kept: unknown[] = [];
  for (const item of value) {
    if (typeof item === "string" && dead.has(item)) changed = true;
    else kept.push(item);
  }
  return changed ? (kept as string[]) : null;
}

/**
 * Repair only references to tombstoned parents, never to a parent that simply
 * has not synced yet. Every replica performs the same projection and no new
 * journal operations are produced.
 */
export function repairReferences(state: MergeState): RepairResult {
  const dead = {
    items: deletedIds(state, "items"),
    projects: deletedIds(state, "projects"),
    tags: deletedIds(state, "tags"),
    schedules: deletedIds(state, "schedules"),
    scheduleItems: deletedIds(state, "scheduleItems"),
    workProjects: deletedIds(state, "workProjects"),
    members: deletedIds(state, "members"),
    habits: deletedIds(state, "habits"),
  };
  const next = new Map(state);
  const changes: RepairChange[] = [];
  const entries = [...state.values()].sort(
    (a, b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id),
  );

  for (const entry of entries) {
    if (entry.deleted || !entry.row) continue;
    const key = rowKey(entry.table, entry.id);
    let row = entry.row;
    let deleted = false;

    switch (entry.table) {
      case "items": {
        for (const [field, deadSet] of [
          ["projectId", dead.projects],
          ["parentId", dead.items],
          ["recurrenceParentId", dead.items],
          ["workProjectId", dead.workProjects],
        ] as const) {
          const patched = clearDeadRef(row, field, deadSet);
          if (patched) {
            row = patched;
            changes.push({ table: entry.table, id: entry.id, action: "cleared", field });
          }
        }
        for (const [field, deadSet] of [
          ["tagIds", dead.tags],
          ["assigneeIds", dead.members],
        ] as const) {
          const patched = withoutDeadIds(row[field], deadSet);
          if (patched) {
            row = { ...row, [field]: patched };
            changes.push({ table: entry.table, id: entry.id, action: "removed-ids", field });
          }
        }
        break;
      }
      case "goals": {
        const patched = clearDeadRef(row, "projectId", dead.projects);
        if (patched) {
          row = patched;
          changes.push({ table: entry.table, id: entry.id, action: "cleared", field: "projectId" });
        }
        break;
      }
      case "workProjects": {
        const patched = clearDeadRef(row, "calendarId", dead.projects);
        if (patched) {
          row = patched;
          changes.push({ table: entry.table, id: entry.id, action: "cleared", field: "calendarId" });
        }
        const members = withoutDeadIds(row.memberIds, dead.members);
        if (members) {
          row = { ...row, memberIds: members };
          changes.push({ table: entry.table, id: entry.id, action: "removed-ids", field: "memberIds" });
        }
        break;
      }
      case "scheduleItems":
      case "scheduleBreaks": {
        if (typeof row.scheduleId === "string" && dead.schedules.has(row.scheduleId)) {
          deleted = true;
        }
        break;
      }
      case "scheduleExceptions": {
        if (
          (typeof row.scheduleId === "string" && dead.schedules.has(row.scheduleId)) ||
          (typeof row.sessionId === "string" && dead.scheduleItems.has(row.sessionId))
        ) {
          deleted = true;
        }
        break;
      }
      case "habitCheckins": {
        if (typeof row.habitId === "string" && dead.habits.has(row.habitId)) deleted = true;
        break;
      }
      case "taskDependencies": {
        const predecessor = row.predecessorId;
        const successor = row.successorId;
        if (
          (typeof predecessor === "string" && dead.items.has(predecessor)) ||
          (typeof successor === "string" && dead.items.has(successor))
        ) {
          deleted = true;
        }
        break;
      }
      default:
        break;
    }

    if (deleted) {
      next.set(key, { ...entry, deleted: true, row: null });
      changes.push({ table: entry.table, id: entry.id, action: "deleted" });
    } else if (row !== entry.row) {
      next.set(key, { ...entry, row });
    }
  }

  return { state: next, changes };
}
