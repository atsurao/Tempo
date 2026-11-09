import { isValidSyncDeviceId, SYNC_FORMAT_VERSION, type SyncFolder } from "./types";

export class SyncFolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncFolderError";
  }
}

function checkDeviceId(deviceId: string): string {
  if (!isValidSyncDeviceId(deviceId)) throw new SyncFolderError("Invalid sync device id.");
  return deviceId;
}

function checkSeq(seq: number, min: number): number {
  if (!Number.isSafeInteger(seq) || seq < min) throw new SyncFolderError("Invalid sync sequence.");
  return seq;
}

function fileName(seq: number): string {
  return `${String(seq).padStart(8, "0")}.json`;
}

function parseSeq(name: string): number | null {
  const match = /^(\d+)\.json$/.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * An in-memory stand-in for the chosen sync folder. It has the same create-if-absent
 * and idempotent-write rules as the native adapter, plus a hold/release switch
 * that lets tests deliver one device's batches late or out of order.
 */
export class FakeSyncFolder implements SyncFolder {
  private files = new Map<string, string>();
  private held = new Map<string, Map<string, string>>();
  private holding = new Set<string>();
  private devices = new Set<string>();
  private archiveCounter = 0;

  async readWorkspace(): Promise<string | null> {
    return this.files.get("workspace.json") ?? null;
  }

  async writeWorkspace(text: string, options?: { replace?: boolean }): Promise<void> {
    if (this.files.has("workspace.json") && !options?.replace) {
      throw new SyncFolderError("A sync workspace already exists in that folder.");
    }
    if (options?.replace) this.archiveDevices();
    this.files.set("workspace.json", text);
  }

  /** Mirror the native replace path: old device folders leave the active set. */
  private archiveDevices(): void {
    this.devices.clear();
    const prefix = `archive/${Date.now()}-${(this.archiveCounter += 1)}/`;
    for (const [path, text] of [...this.files]) {
      if (!path.startsWith("devices/")) continue;
      this.files.delete(path);
      this.files.set(`${prefix}${path}`, text);
    }
    for (const [deviceId, pending] of [...this.held]) {
      for (const [path, text] of [...pending]) {
        if (!path.startsWith("devices/")) continue;
        pending.delete(path);
        pending.set(`${prefix}${path}`, text);
      }
      if (pending.size === 0) this.held.delete(deviceId);
    }
  }

  async createWorkspace(workspaceId: string, createdBy = "test"): Promise<void> {
    await this.writeWorkspace(
      JSON.stringify({
        format: "tempo-sync-workspace",
        version: SYNC_FORMAT_VERSION,
        workspaceId,
        createdAt: 1,
        createdBy,
      }),
    );
  }

  async listDevices(): Promise<string[]> {
    return [...this.devices].sort();
  }

  async readMeta(deviceId: string): Promise<string | null> {
    checkDeviceId(deviceId);
    return this.files.get(this.metaPath(deviceId)) ?? null;
  }

  async writeMeta(deviceId: string, text: string): Promise<void> {
    checkDeviceId(deviceId);
    this.devices.add(deviceId);
    this.files.set(this.metaPath(deviceId), text);
  }

  async listBatches(deviceId: string): Promise<number[]> {
    checkDeviceId(deviceId);
    return this.listSeqs(this.prefix(deviceId, "ops"), 1);
  }

  async readBatch(deviceId: string, seq: number): Promise<string | null> {
    checkDeviceId(deviceId);
    checkSeq(seq, 1);
    return this.files.get(this.opPath(deviceId, seq)) ?? null;
  }

  async writeBatch(deviceId: string, seq: number, text: string): Promise<void> {
    checkDeviceId(deviceId);
    checkSeq(seq, 1);
    this.devices.add(deviceId);
    this.put(this.opPath(deviceId, seq), text, deviceId);
  }

  async deleteBatch(deviceId: string, seq: number): Promise<void> {
    checkDeviceId(deviceId);
    checkSeq(seq, 1);
    const path = this.opPath(deviceId, seq);
    this.files.delete(path);
    this.held.get(deviceId)?.delete(path);
  }

  async listSnapshots(deviceId: string): Promise<number[]> {
    checkDeviceId(deviceId);
    return this.listSeqs(this.prefix(deviceId, "snapshots"), 0);
  }

  async readSnapshot(deviceId: string, seq: number): Promise<string | null> {
    checkDeviceId(deviceId);
    checkSeq(seq, 0);
    return this.files.get(this.snapshotPath(deviceId, seq)) ?? null;
  }

  async writeSnapshot(deviceId: string, seq: number, text: string): Promise<void> {
    checkDeviceId(deviceId);
    checkSeq(seq, 0);
    this.devices.add(deviceId);
    this.put(this.snapshotPath(deviceId, seq), text, deviceId);
  }

  async deleteSnapshot(deviceId: string, seq: number): Promise<void> {
    checkDeviceId(deviceId);
    checkSeq(seq, 0);
    const path = this.snapshotPath(deviceId, seq);
    this.files.delete(path);
    this.held.get(deviceId)?.delete(path);
  }

  /** Delay this device's next writes, as if a sync service had not copied them yet. */
  hold(deviceId: string): void {
    checkDeviceId(deviceId);
    this.holding.add(deviceId);
  }

  /** Publish everything this device wrote while it was held. */
  release(deviceId: string): void {
    checkDeviceId(deviceId);
    this.holding.delete(deviceId);
    const pending = this.held.get(deviceId);
    if (!pending) return;
    for (const [path, text] of pending) {
      const existing = this.files.get(path);
      if (existing !== undefined && existing !== text) {
        throw new SyncFolderError("A held file conflicts with an existing file.");
      }
      this.files.set(path, text);
    }
    pending.clear();
  }

  /** Publish one held file, leaving the rest undelivered. */
  releaseOne(deviceId: string, seq: number): void {
    checkDeviceId(deviceId);
    checkSeq(seq, 1);
    const path = this.opPath(deviceId, seq);
    const pending = this.held.get(deviceId);
    const text = pending?.get(path);
    if (text === undefined) {
      throw new SyncFolderError("That batch is not waiting to be delivered.");
    }
    const existing = this.files.get(path);
    if (existing !== undefined && existing !== text) {
      throw new SyncFolderError("A held file conflicts with an existing file.");
    }
    this.files.set(path, text);
    pending?.delete(path);
  }

  heldBatches(deviceId: string): number[] {
    checkDeviceId(deviceId);
    const pending = this.held.get(deviceId);
    if (!pending) return [];
    const seqs: number[] = [];
    for (const path of pending.keys()) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      const seq = parseSeq(name);
      if (seq !== null) seqs.push(seq);
    }
    return seqs.sort((a, b) => a - b);
  }

  hasBatch(deviceId: string, seq: number): boolean {
    return this.files.has(this.opPath(deviceId, seq));
  }

  private prefix(deviceId: string, kind: "ops" | "snapshots"): string {
    return `devices/${deviceId}/${kind}/`;
  }

  private metaPath(deviceId: string): string {
    return `devices/${deviceId}/meta.json`;
  }

  private opPath(deviceId: string, seq: number): string {
    return `${this.prefix(deviceId, "ops")}${fileName(seq)}`;
  }

  private snapshotPath(deviceId: string, seq: number): string {
    return `${this.prefix(deviceId, "snapshots")}${fileName(seq)}`;
  }

  private listSeqs(prefix: string, min: number): number[] {
    const seqs: number[] = [];
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const seq = parseSeq(path.slice(path.lastIndexOf("/") + 1));
      if (seq !== null && seq >= min) seqs.push(seq);
    }
    return seqs.sort((a, b) => a - b);
  }

  private put(path: string, text: string, deviceId: string): void {
    if (this.holding.has(deviceId)) {
      let pending = this.held.get(deviceId);
      if (!pending) {
        pending = new Map();
        this.held.set(deviceId, pending);
      }
      const existing = pending.get(path) ?? this.files.get(path);
      if (existing !== undefined && existing !== text) {
        throw new SyncFolderError("That sync file already exists with different content.");
      }
      pending.set(path, text);
      return;
    }
    const existing = this.files.get(path);
    if (existing !== undefined && existing !== text) {
      throw new SyncFolderError("That sync file already exists with different content.");
    }
    this.files.set(path, text);
  }
}
