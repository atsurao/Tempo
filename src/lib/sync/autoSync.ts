import { db } from "../../db/db";
import type { SyncRunResult } from "./engine";
import { syncNow } from "./setup";
import { SYNCED_TABLE_SET } from "./types";

/**
 * Background sync lifecycle.
 *
 * A local edit schedules one pass after the burst settles; launch and window
 * focus ask for a pass too. The pass is deliberately not forced, so an outbox
 * row waiting for its retry backoff stays put instead of hammering the folder.
 * Manual "Sync now" in Settings still forces.
 */

const DEFAULT_TIMING = {
  editIdleMs: 1_500,
  maxBurstMs: 5_000,
  launchDelayMs: 1_500,
  focusDelayMs: 400,
  pollIntervalMs: 30_000,
  queuedDelayMs: 500,
  errorRetryMs: 60_000,
  pendingRetryMs: 30_000,
  gapRetryMs: 15_000,
  minRetryMs: 1_000,
};

type AutoSyncTiming = typeof DEFAULT_TIMING;
let timing: AutoSyncTiming = { ...DEFAULT_TIMING };

let installed = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let queued = false;
let dirty = false;
let burstStartedAt: number | null = null;
let retryNotBefore = 0;

function schedule(delay: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runAutoSync();
  }, delay);
}

function retryDelay(result: SyncRunResult): number | null {
  if (result.flush.status === "backoff" && result.flush.retryAt !== null) {
    return Math.max(timing.minRetryMs, result.flush.retryAt - Date.now());
  }
  if (result.flush.status === "error" || result.pull.status === "error") {
    return timing.errorRetryMs;
  }
  if (result.flush.pending > 0) return timing.pendingRetryMs;
  if (result.pull.waiting.length > 0) return timing.gapRetryMs;
  return null;
}

async function runAutoSync(): Promise<void> {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  let retry: number | null = null;
  try {
    const device = await db.syncDevice.get("local");
    if (!device?.enabled || device.paused) {
      dirty = false;
      return;
    }

    dirty = false;
    burstStartedAt = null;
    retryNotBefore = 0;
    retry = retryDelay(await syncNow(undefined, { force: false }));
  } catch {
    // A missing folder, an unplugged drive or a closed laptop is not a reason
    // to toast on every edit. Try again after the burst; the next focus is
    // faster.
    retry = timing.errorRetryMs;
  } finally {
    running = false;
    if (queued) {
      queued = false;
      schedule(timing.queuedDelayMs);
    } else if (dirty) {
      schedule(editDelay());
    } else if (retry !== null) {
      retryNotBefore = Date.now() + retry;
      schedule(retry);
    }
  }
}

/** Never let a continuous stream of edits postpone the pass forever. */
function editDelay(): number {
  if (burstStartedAt === null) return timing.editIdleMs;
  const remaining = timing.maxBurstMs - (Date.now() - burstStartedAt);
  return Math.max(0, Math.min(timing.editIdleMs, remaining));
}

/** Mark a workspace edit; the pass waits for the edit burst to settle. */
export function scheduleAutoSync(): void {
  if (burstStartedAt === null) burstStartedAt = Date.now();
  dirty = true;
  if (running) {
    queued = true;
    return;
  }
  schedule(editDelay());
}

/** Flush pending work now, used when the window is hidden or closing. */
export function flushAutoSync(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  void runAutoSync();
}

/** Launch pass: called after the first-run/seed sequence has finished. */
export function primeAutoSync(): void {
  schedule(timing.launchDelayMs);
}

/** A focus pass: coalesced with edit work rather than starting a second run. */
export function focusAutoSync(): void {
  schedule(timing.focusDelayMs);
}

/**
 * One foreground tick, separate from the interval so it can be exercised by
 * the timer tests without inventing a second sync path.
 */
function pollAutoSync(): void {
  if (running) return;
  if (Date.now() < retryNotBefore) return;
  schedule(0);
}

/** Start the visible-window poll. Repeating calls are harmless. */
export function startForegroundPoll(): void {
  if (pollTimer !== null) return;
  pollTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    pollAutoSync();
  }, timing.pollIntervalMs);
}

export function stopForegroundPoll(): void {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

/**
 * Watch workspace writes once per page. Journal tables and settings are
 * ignored: otherwise a sync would schedule itself and the status read would
 * look like a user edit.
 */
export function installAutoSync(): void {
  if (installed) return;
  installed = true;

  db.use({
    stack: "dbcore",
    name: "tempo-auto-sync",
    create: (down) => ({
      ...down,
      table: (name) => {
        const table = down.table(name);
        if (!SYNCED_TABLE_SET.has(name)) return table;
        return {
          ...table,
          mutate: (request) => {
            const result = table.mutate(request);
            scheduleAutoSync();
            return result;
          },
        };
      },
    }),
  });

  if (typeof window === "undefined") return;

  if (document.visibilityState === "visible") startForegroundPoll();
  window.addEventListener("focus", () => {
    if (document.visibilityState === "visible") {
      startForegroundPoll();
      focusAutoSync();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      startForegroundPoll();
      focusAutoSync();
    } else {
      stopForegroundPoll();
      if (dirty) flushAutoSync();
    }
  });
  window.addEventListener("pagehide", () => {
    stopForegroundPoll();
    if (dirty) flushAutoSync();
  });
}

/** Clear timers between tests without removing the middleware. */
export function __resetAutoSyncForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  stopForegroundPoll();
  running = false;
  queued = false;
  dirty = false;
  burstStartedAt = null;
  retryNotBefore = 0;
  timing = { ...DEFAULT_TIMING };
}

/** Shorten the timers so a real-timer test does not wait seconds. */
export function __setAutoSyncTimingForTests(patch: Partial<AutoSyncTiming>): void {
  timing = { ...timing, ...patch };
}
