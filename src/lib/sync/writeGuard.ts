import Dexie, { type Transaction } from "dexie";
import { SYNCED_TABLE_SET } from "./types";

/**
 * The guard allows two things, both keyed by the live Dexie transaction: a
 * one-shot permit issued immediately by a synced helper, or an explicit
 * whole-workspace bypass for seed/restore. A module-level boolean would race
 * concurrent async transactions; these WeakMaps do not.
 */
const bypassed = new WeakSet<object>();
const permits = new WeakMap<object, number>();
let installed = false;

export class SyncWriteGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncWriteGuardError";
  }
}

export function bypassCurrentSyncTransaction(): void {
  const tx = Dexie.currentTransaction as Transaction | undefined;
  if (tx) bypassed.add(tx);
}

/** The helper calls this immediately before its own domain put/delete. */
export function permitCurrentSyncWrite(): void {
  const tx = Dexie.currentTransaction as Transaction | undefined;
  if (tx) permits.set(tx, (permits.get(tx) ?? 0) + 1);
}

export function installSyncWriteGuard(database: Dexie): void {
  if (!import.meta.env.DEV || installed) return;
  installed = true;

  database.use({
    stack: "dbcore",
    name: "tempo-sync-write-guard",
    create: (down) => ({
      ...down,
      table: (name) => {
        const table = down.table(name);
        if (!SYNCED_TABLE_SET.has(name)) return table;
        return {
          ...table,
          mutate: (request) => {
            const tx = Dexie.currentTransaction as Transaction | undefined;
            const allowed = tx && (bypassed.has(tx) || (permits.get(tx) ?? 0) > 0);
            if (!tx || !allowed) {
              throw new SyncWriteGuardError(
                `Blocked a direct write to "${name}". Use a synced repository helper.`,
              );
            }
            if (!bypassed.has(tx)) permits.set(tx, (permits.get(tx) ?? 1) - 1);
            return table.mutate(request);
          },
        };
      },
    }),
  });
}
