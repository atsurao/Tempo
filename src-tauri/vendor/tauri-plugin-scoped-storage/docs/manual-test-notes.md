# Manual Test Notes

## Android

- Pick a folder, restart the app, and confirm `listFolders` still returns the same handle.
- Reopen the saved handle and verify `readDir`, `readTextFile`, and `writeTextFile` still work after restart.
- Create nested directories, copy them, move them, rename them, and remove them recursively.
- Verify `appendFile` appends instead of replacing file contents.
- Verify `truncate` both shrinks and grows files safely.
- Test large files to confirm stream-based copy and write paths stay responsive.
- Test non-ASCII folder and file names.

## iOS

- Pick a folder, restart the app, and confirm the bookmark-backed handle is restored by `listFolders`.
- Verify stale bookmark refresh by reusing a saved handle after system bookmark refresh conditions.
- Create nested directories and files, then copy, move, rename, and remove them.
- Confirm `appendFile` preserves previous bytes and adds new bytes at the end.
- Confirm `truncate` shrinks files and pads with zero bytes when growing.
- Test non-ASCII file names and nested paths.

## Cross-Platform

- Confirm structured errors are surfaced for invalid paths, missing folders, missing files, and destination collisions.
- Confirm destructive commands reject empty relative paths.
- Verify binary reads round-trip exact byte sequences without base64 conversion.
