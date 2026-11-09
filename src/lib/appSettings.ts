import { db, getSetting, setSetting } from "../db/db";

/**
 * Preferences that describe the install rather than the workspace: whether
 * setup has run, whether the welcome screen shows, and where backups go.
 * They live in the same local database as everything else, so nothing here
 * leaves the machine.
 */

const KEY_ONBOARDED = "onboarded";
const KEY_SPLASH = "show-splash";
const KEY_BACKUP = "backup-config";

export interface BackupConfig {
  /** Write a backup after edits settle. */
  enabled: boolean;
  /** The folder the user chose; null until setup picks one. */
  folder: string | null;
  /** When the last successful automatic backup was written. */
  lastAt: number | null;
  /** The file it landed in, for the Settings row. */
  lastPath: string | null;
  /** When the last searchable history snapshot was taken. */
  lastSnapshotAt: number | null;
}

export const DEFAULT_BACKUP: BackupConfig = {
  enabled: true,
  folder: null,
  lastAt: null,
  lastPath: null,
  lastSnapshotAt: null,
};

function isBackupConfig(value: unknown): value is Partial<BackupConfig> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readBackupConfig(): Promise<BackupConfig> {
  const raw = await getSetting<unknown>(KEY_BACKUP, null);
  if (!isBackupConfig(raw)) return { ...DEFAULT_BACKUP };
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_BACKUP.enabled,
    folder: typeof raw.folder === "string" && raw.folder ? raw.folder : null,
    lastAt: typeof raw.lastAt === "number" ? raw.lastAt : null,
    lastPath: typeof raw.lastPath === "string" ? raw.lastPath : null,
    lastSnapshotAt: typeof raw.lastSnapshotAt === "number" ? raw.lastSnapshotAt : null,
  };
}

export async function writeBackupConfig(patch: Partial<BackupConfig>): Promise<BackupConfig> {
  const next = { ...(await readBackupConfig()), ...patch };
  await setSetting(KEY_BACKUP, next);
  return next;
}

export async function readShowSplash(): Promise<boolean> {
  return getSetting<boolean>(KEY_SPLASH, true);
}

export async function setShowSplash(show: boolean): Promise<void> {
  await setSetting(KEY_SPLASH, show);
}

/** null means this install has never been through setup. */
export async function readOnboarded(): Promise<boolean | null> {
  const value = await getSetting<unknown>(KEY_ONBOARDED, null);
  return typeof value === "boolean" ? value : null;
}

export async function setOnboarded(value = true): Promise<void> {
  await setSetting(KEY_ONBOARDED, value);
}

/**
 * "First ever launch" is a database with no setup decision and no work in it.
 * An install that already has items predates setup — most likely this one —
 * so it is marked done silently instead of being walked through a wizard for
 * data it already owns.
 */
export async function needsSetup(): Promise<boolean> {
  const onboarded = await readOnboarded();
  if (onboarded !== null) return false;
  const items = await db.items.count();
  if (items > 0) {
    await setOnboarded();
    return false;
  }
  return true;
}
