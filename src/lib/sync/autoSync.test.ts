import "fake-indexeddb/auto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllData, createItem, db } from "../../db/db";
import type { SyncRunResult } from "./engine";
import {
  __resetAutoSyncForTests,
  __setAutoSyncTimingForTests,
  focusAutoSync,
  installAutoSync,
  primeAutoSync,
  startForegroundPoll,
} from "./autoSync";
import { syncNow } from "./setup";
import type { SyncDeviceRow } from "./types";

vi.mock("./setup", () => ({
  syncNow: vi.fn(),
}));

const syncMock = vi.mocked(syncNow);

const DEVICE: SyncDeviceRow = {
  key: "local",
  deviceId: "mac",
  installId: "install-mac",
  workspaceId: "ws_test",
  deviceName: "Mac",
  lastSeq: 0,
  lastSnapshotSeq: 0,
  enabled: true,
  paused: false,
  folderKind: "folder",
  folderLabel: "/Users/test/Tempo",
};

const TEST_TIMING = {
  // Keep the idle window comfortably above the short sleeps below; under a
  // loaded parallel test run, an 8 ms timer can otherwise fire first.
  editIdleMs: 80,
  launchDelayMs: 10,
  focusDelayMs: 5,
  pollIntervalMs: 25,
  queuedDelayMs: 5,
  errorRetryMs: 50,
  pendingRetryMs: 50,
  gapRetryMs: 20,
  minRetryMs: 5,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function idle(): SyncRunResult {
  return {
    flush: {
      status: "idle",
      written: 0,
      pending: 0,
      error: null,
      retryAt: null,
    },
    pull: {
      status: "idle",
      appliedBatches: 0,
      appliedSnapshots: 0,
      conflicts: 0,
      merged: 0,
      repairs: 0,
      waiting: [],
      blocked: [],
      errors: [],
    },
  };
}

async function resetDatabase(): Promise<void> {
  await db.syncDevice.clear();
  await clearAllData();
  await db.settings.delete("sync.resetPending");
}

describe("background sync", () => {
  beforeAll(async () => {
    installAutoSync();
    await db.open();
  });

  beforeEach(async () => {
    __resetAutoSyncForTests();
    await resetDatabase();
    __resetAutoSyncForTests();
    syncMock.mockReset();
    syncMock.mockResolvedValue(idle());
    await db.syncDevice.put(DEVICE);
    __setAutoSyncTimingForTests(TEST_TIMING);
  });

  afterEach(() => {
    __resetAutoSyncForTests();
  });

  it("waits for an edit burst to settle before a pass", async () => {
    await createItem({ type: "task", title: "One" });
    await sleep(8);
    expect(syncMock).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1), {
      timeout: 500,
      interval: 5,
    });
    expect(syncMock).toHaveBeenCalledWith(undefined, { force: false });
  });

  it("resets the idle timer when another edit arrives", async () => {
    await createItem({ type: "task", title: "One" });
    await sleep(10);
    await createItem({ type: "task", title: "Two" });
    await sleep(10);

    expect(syncMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1), {
      timeout: 500,
      interval: 5,
    });
  });

  it("does nothing while sync is paused", async () => {
    await db.syncDevice.update("local", { paused: true });
    await createItem({ type: "task", title: "Paused edit" });

    await sleep(60);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("runs after launch and again when the window gains focus", async () => {
    primeAutoSync();
    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1), {
      timeout: 500,
      interval: 5,
    });

    syncMock.mockClear();
    focusAutoSync();
    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1), {
      timeout: 500,
      interval: 5,
    });
  });

  it("polls while the app is in the foreground", async () => {
    startForegroundPoll();
    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1), {
      timeout: 500,
      interval: 5,
    });
  });

  it("retries at the outbox backoff time", async () => {
    syncMock.mockImplementation(async () => ({
      ...idle(),
      flush: {
        status: "backoff",
        written: 0,
        pending: 1,
        error: "Waiting to retry",
        retryAt: Date.now() + 30,
      },
    }));

    await createItem({ type: "task", title: "Pending" });
    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1), {
      timeout: 500,
      interval: 5,
    });

    await sleep(10);
    expect(syncMock).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(2), {
      timeout: 500,
      interval: 5,
    });
  });

  it("coalesces an edit made during a pass into one follow-up", async () => {
    let release: ((result: SyncRunResult) => void) | null = null;
    syncMock.mockImplementationOnce(
      () =>
        new Promise<SyncRunResult>((resolve) => {
          release = resolve;
        }),
    );

    await createItem({ type: "task", title: "First" });
    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1), {
      timeout: 500,
      interval: 5,
    });

    await createItem({ type: "task", title: "During the pass" });
    release!(idle());

    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(2), {
      timeout: 500,
      interval: 5,
    });
  });
});
