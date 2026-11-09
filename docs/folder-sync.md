# Shared-folder sync

Tempo syncs by reading and writing a folder that another app already keeps in
step between devices. The folder can live inside iCloud Drive, Dropbox, Google
Drive, OneDrive, Syncthing, a network share or any other file-sharing service.
Tempo does not authenticate to, watch or inspect that service. It only operates
on the local folder the user chooses.

## Journal layout

```text
<chosen folder>/
  workspace.json
  devices/
    <device-id>/
      meta.json
      ops/
        000000000001.json
        000000000002.json
      snapshots/
        000000000000.json
  archive/
```

- `workspace.json` identifies one workspace and is create-if-absent. Only an
  explicit Start-new replaces it.
- Each device writes only inside its own `devices/<device-id>/` directory, so
  two devices never write the same file.
- `ops/<seq>.json` is one immutable transaction batch. Sequences are per device.
- `snapshots/<seq>.json` is a full state snapshot at that device's sequence.
- A Start-new moves the previous `devices/` directory into `archive/`, so old
  workspace files cannot be mistaken for current peers.
- Journal files are plain JSON. Tempo asks for `0600` files and `0700`
  directories on Unix; some file-service folders do not support POSIX modes,
  so the protection is best effort there.
- Tempo writes temporary files outside the journal and moves them into place
  atomically. A provider's conflict copy such as `00000004.json (1)` is ignored.

## File formats

`workspace.json`:

```json
{
  "format": "tempo-sync-workspace",
  "version": 1,
  "workspaceId": "ws_...",
  "createdAt": 1760000000000,
  "createdBy": "device-id"
}
```

A batch contains complete rows rather than patches:

```json
{
  "format": "tempo-sync-batch",
  "version": 1,
  "workspaceId": "ws_...",
  "deviceId": "device-id",
  "seq": 42,
  "createdAt": 1760000000000,
  "dataVersion": 5,
  "ops": [
    {
      "table": "items",
      "id": "item-id",
      "kind": "put",
      "rev": 7,
      "writer": "device-id",
      "at": 1760000000000,
      "row": {}
    }
  ]
}
```

`kind` is `put` or `del`. A snapshot carries the same row shape plus tombstones
and an `included` map recording the highest batch read from each writer.

## Merge rules

Every synced row has a `syncState` record with a per-row Lamport `rev` and the
`writer` that produced it.

1. A local write increments the row's revision and appends a full-row op to the
   current Dexie transaction.
2. A remote op wins when its `(rev, writer)` is greater than the local pair.
   Equal pairs are duplicates. Wall-clock `at` never decides a conflict.
3. A winning delete leaves a tombstone. A stale put cannot resurrect it.
4. Soft deletes (`deletedAt` on items and goals) are ordinary puts; a purge is a
   tombstone.
5. References to a tombstoned parent are repaired deterministically after a
   sync pass. Missing parents are not treated as deleted because they may still
   be arriving.
6. Conflicts are record-level last-writer-wins. The losing local row is kept in
   `syncConflicts` for seven days and is never written to the journal.

## Write capture

Every workspace table write goes through `syncedTransaction` in `src/db/db.ts`.
The domain row, its `syncState` revision and its `syncOutbox` batch are written
in one Dexie transaction. A crash cannot leave a local edit without a journal
entry. The dev-only guard rejects direct domain writes outside the sync context.

The outbox is flushed serially. A failed write stays pending with backoff; it is
never dropped. The same `(deviceId, seq)` with identical bytes is a successful
retry. A different payload at the same sequence is an error.

## Sync passes

A pass flushes pending local batches, lists peer directories, applies snapshots
and then batches in sequence order, and repairs tombstoned references. Gaps are
reported as waiting rather than skipped. A cursor update happens in the same
Dexie transaction as the rows it covers.

Passes run:

- at launch;
- when the window gains focus;
- after an edit burst settles;
- while the window is visible, every 30 seconds;
- when the user chooses **Sync now**.

The foreground poll is the only automatic way Tempo notices files another
device wrote. Upload and download timing belongs entirely to the file-sharing
app, so Tempo makes no claim that a file has reached another device.

## Setup and joining

Settings → Sync asks for a local folder. The native layer validates that it is
an absolute existing directory, resolves it to a canonical path and rejects the
disk root. The path is stored locally; it is never synced to other devices.

- An empty folder becomes a new workspace with a snapshot of this device.
- An empty local database joins the workspace already in the folder.
- A folder with a workspace and a non-empty local database stops at an explicit
  **Join** or **Start a new workspace** choice. Joining writes a JSON backup
  first.
- A reset or JSON restore clears the sync tables and sets `sync.resetPending`;
  the next enable requires an explicit join or Start-new choice.

Pausing stops folder reads and writes. Local edits continue to enter the
journal, and resuming writes the backlog.

## Compaction

A snapshot is written after 500 batches or 7 days. The latest three snapshots
are kept. Op batches are retained for at least 30 days and then removed only
when a snapshot covers them. Tombstones are kept indefinitely. A device offline
past retention bootstraps from a snapshot; if it has unsynced local work, the
user must choose between replacing from sync and starting a new workspace.

## Failure behavior

| Failure | Behavior |
|---|---|
| Folder missing, moved or unmounted | Queue locally, show the folder reason, never delete local data. |
| Folder read-only or permission denied | Keep the outbox and show the write error. |
| Partial or corrupt JSON | Do not advance the cursor; keep the file for diagnosis. |
| Duplicate batch with different bytes | Stop at that sequence; require manual repair. |
| Sequence gap | Wait for the missing batch; never skip ahead. |
| Workspace mismatch | Refuse to merge and require Join or Start-new. |
| Provider conflict copy | Ignore the `name (1).json` file; only exact numeric names count. |

## Code map

- `src/lib/sync/engine.ts` — outbox flush and remote apply.
- `src/lib/sync/merge.ts` — validation, revisions and snapshots.
- `src/lib/sync/setup.ts` — folder choice, enable, join, Start-new and pause.
- `src/lib/sync/autoSync.ts` — launch, focus, edit and foreground triggers.
- `src/lib/sync/tauriFolder.ts` — desktop bridge for the chosen folder.
- `src-tauri/src/sync_folder.rs` — validated root, atomic file operations and
  local-device enforcement.
- `src/lib/sync/fakeFolder.ts`, `diskFolder.ts` and `convergence.test.ts` —
  in-memory and real-filesystem convergence tests.

## Manual test matrix

Use at least two devices with the same folder shared by one file-sharing app:

- create, edit, delete and restore on each device;
- edit both devices offline, then reconnect;
- leave one app closed while the other writes, then open it;
- point the app at a folder that does not exist, then at a read-only folder;
- pause with pending batches and resume;
- reset one device and confirm it requires Join or Start-new;
- let one device stay offline past a compaction and confirm it bootstraps from a
  snapshot rather than skipping batches.
