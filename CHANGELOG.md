# Changelog

Notable changes per release. Versions follow `major.minor.patch`; the same
number is kept in `package.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml`.

## Unreleased

## 0.3.8 — 2026-11-06

### Added

- Tasks can be duplicated from the quick-look menu on desktop and by
  right-clicking or tap-and-holding a task on a phone.
- Overdue tasks now offer a **Postpone** button in the task list, Today pane,
  board and timeline. It opens a date menu with tomorrow, three days, next week
  and a date picker, preserving the original time of day. Every move can be
  undone from the toast.
- The calendar's all-day band can be dragged taller when it overflows, and it
  scrolls independently of the timed calendar below. A band with no overflow
  keeps its natural height with no handle and no scrolling.
- On phones, task and event quick-look sheets, postpone menus and the sort/filter
  sheet can be dismissed by swiping down on the grabber. A short pull springs
  back instead of closing.

### Changed

- Completing a task animates it out of the task list and Today, and removes it
  from the calendar's all-day band after the same short exit animation.

### Fixed

- Leaving a view during a task's completion animation still completes the task.
- Completed timed tasks leave Today's timeline instead of returning checked
  after their exit animation.
- Duplicating an all-day or end-of-day item keeps the copy on the same day.
- **Show schedule** now honors one-off session edits and deletions.
- Resizing the calendar's all-day band cleans up its drag listeners when the
  calendar closes mid-drag.
- Sync can read existing journals from data version 5, so folders created
  before timetable exceptions continue to work.
- A change from another device no longer appears as a conflict just because
  this device created the row, or because the other device deleted a row this
  device had not edited. Synced rows now carry a causal clock, so editing after
  pulling the other device's latest revision is recognized as a later change;
  genuinely simultaneous edits still keep a recoverable copy.

## 0.3.7 — 2026-11-05

### Added

- Timetable occurrences can now be changed one at a time. Right-click or
  tap-and-hold a schedule event to edit its title, place or time for that date,
  or to delete just that occurrence. Both paths say plainly that the weekly
  timetable and every other week stay unchanged, and a deletion can be undone.

### Fixed

- Desktop pane splitters follow the pointer from where it was grabbed instead
  of jumping before the drag begins.
- Opening the calendar returns to the current week. On phones the week is
  aligned to today; on the desktop it stays aligned to the start of the week.
- The tasks page's **Next 7 days** view now includes tasks due today.

## 0.3.6 — 2026-11-02

### Changed

- Repository cleanup: removed the unused legacy month/week scroll-snap helpers
  and their tests, along with 57 stale development screenshots and stray macOS
  metadata. Active sync test harnesses and platform assets were kept.

## 0.3.5 — 2026-11-02

### Added

- Tags are now a live collection. The task page's **Sort & tags** menu can
  order work by tag and narrow the list to one tag, while the desktop sidebar
  gains a fold-out tag index with task/event counts. Selecting a tag opens the
  task page already filtered; selecting an item in the editor adds it to that
  tag's collection, including events.
- Tags can be renamed, recoloured or deleted from their context menu: right-
  click a tag in the sidebar or **Sort & tags** menu on desktop, or long-press
  it on the phone. Deleting a tag removes only its memberships and the tag
  itself; tagged tasks and events are kept.
- Subtle interaction motion across desktop and phone: completed checks land,
  progress bars catch up, active navigation responds, and tag lists unfold
  with a short stagger. Reduced-motion preferences continue to disable it.

### Fixed

- Task tags now occupy their own full-width row directly under the title, so
  their left edge never shifts with a due date or other metadata. Completion
  percentages stay in the same left-aligned progress block. Board cards follow
  the same order.
- Renaming a tag on mobile keeps the tag sheet open while the software keyboard
  opens and resizes the viewport, so the name can actually be edited.

## 0.3.4 — 2026-11-01

### Added

- Desktop: drag a view from the sidebar onto the workspace to open it as a
  pane. Drop on the left or right side to split the workspace like window
  snapping; drop in the center to add a pane without forcing a half split.
- The Tempo icon in the title bar opens an About card on both Mac and iPhone,
  with the app icon, build version, copyright and license.

## 0.3.3 — 2026-11-01

### Fixed

- Tasks due today no longer disappear from Today or the calendar on a 25-hour
  daylight-saving fall-back day. Day boundaries now use the real end of the
  local day instead of adding a fixed 24 hours, which had cut off the final
  hour and with it the default 23:59 due time. The same fix covers the agenda,
  widgets, Today badges, and the next-event status bar.

## 0.3.2 — 2026-11-01

### Added

- Sync now resolves concurrent edits automatically. When two devices change
  different fields of the same row, both changes are combined into one new
  revision and published, so every device and snapshot converges without
  manual work. Tag, member and weekday lists combine as sets.
- The sync summary reports how many edits were combined.

### Changed

- A true collision (both devices changed the same field) still applies the
  deterministic writer winner, but keeps the local copy available to restore.

## 0.3.1 — 2026-11-01

### Fixed

- Week view: Today opens the correct week on the phone, where the layout gives
  every day a fixed 108 px column instead of the fit calculation's ~54 px.
- Week view: the first day of the week is fully visible beside the pinned time
  gutter instead of being clipped by it.

## 0.3.0 — 2026-11-01

### Added

- Project editors set a default calendar and can be opened from the project's
  context menu, with name, colour, start, finish and working days in one place.
- Gantt outline rows drag to reorder among their siblings.
- Task lists sort by due date, priority, title or age as well as manual order.
- A generated US holiday calendar — federal days, Easter, Valentine's, Halloween,
  Thanksgiving, Black Friday and more — toggled from the calendar toolbar.
- A widget board with five glances: today at a glance, today's tasks, today's
  calendar, the whole day, and next up.

### Changed

- The month view is one continuous run of weeks with a month label that follows
  the scroll, instead of repeating weeks at every month boundary.
- Task metadata keeps tags beside the due date and left-aligned in every row.
- Archiving a project asks for confirmation first.
- The iOS app icon now uses the same Tempo artwork as the Mac app.

### Fixed

- Weeks at month boundaries no longer appear twice in the month view.

## 0.2.0 — 2026-10-30

### Added

- **iPhone shell**: the same workspace in a phone layout — bottom tabs, one view
  at a time, full-height editors, bottom action sheets in place of right-click
  menus, and tap targets for calendar events, month cells and Gantt rows.
- **Navigation settings**: Settings → Navigation chooses which views appear in
  the phone's bottom bar (four beside More) and the desktop sidebar, reorders
  them, and resets to the defaults. Each device keeps its own navigation, and
  views turned off the bar stay reachable under More.
- **In-place tab editing**: a long press on the phone's bottom bar turns it into
  an editor — drag tabs to reorder, tap × to move one under More, and Add a view
  back without opening Settings.
- **Sectioned phone sheets**: long sheets split into named tabs (item editor,
  Settings → Data and Sync, weekly schedule, delegation, project team), and long
  action sheets keep secondary actions behind a More page.
- **iOS sync folder picker**: Settings → Sync uses the Files app's
  security-scoped folder picker and keeps the bookmark across launches. On the
  phone, automatic backups live in Tempo's Documents folder, visible in Files.
- **iOS build target**: a Tauri iOS project, `Info.ios.plist` with file sharing
  enabled, and `docs/iphone.md` for installing a personal build with a free
  Apple ID.

### Changed

- **Sync uses a shared folder, not iCloud**: choose the local folder that
  iCloud Drive, Dropbox, Google Drive, Syncthing or another file-sharing app
  already keeps in step. Tempo only reads and writes journal files in that
  folder; it no longer requests an iCloud container, inspects upload state or
  opens iCloud Settings.

## 0.1.1 — 2026-10-28

### Added

- **First-run setup**: a short wizard for theme, accent and clock, the backup
  folder, and starting blank, importing `.ics` calendars or restoring an
  automatic snapshot or a Tempo JSON backup — each import gets a name and colour
  before it lands.
- **Restore from setup**: the first-run **Restore a backup** option lists the
  automatic snapshots in the backup folder, newest first, with dates, counts
  and indexed names. Pick one and restore, or choose a JSON file from anywhere.
- **Welcome screen**: a brief launch card naming the app, what it does and the
  running version, with a switch to turn it off here or in Settings.
- **Automatic backups**: after edits settle, the workspace is written to
  `tempo-autosave.json` in a chosen folder (app data by default, or any folder
  such as iCloud Drive), atomically and with the previous copy rotated.
- **Backup history**: an hourly snapshot kept for two weeks in
  `tempo-history/` (capped at 336 files / 150 MB). Settings → Data → **Backup
  history** searches by name, date or time, previews a snapshot and restores
  it, keeping the replaced workspace as another snapshot first.
- **Reorderable sidebar lists**: calendars, projects and schedules drag within
  their own list with the same mechanic as the view buttons, and the order is
  persisted per row.
- **Settings sidebar**: settings are split into Appearance, Calendar, Tasks,
  Notifications, Data and Shortcuts. A search field at the top of the sidebar
  matches labels, descriptions and everyday words, then jumps to and flashes
  the matching row.
- **Settings → Data** shows the backup folder, last save time, a manual
  **Back up now** button, and **Run setup again**.
- **Reset all data**: a two-step confirmation in Settings → Data that deletes
  the workspace and preferences on this device, then reopens setup. A backup
  can be saved from the first step before anything is removed.
- **Habits**: a separate recurring category with week schedules, daily
  check-ins, streaks and a 30-day completion rate, in its own sidebar view.
- **Habits on Today**: today's habits sit in their own card under *Next up*,
  each checkable in place with its streak and a count of what is left.
- **Task time blocks**: a task can hold any number of calendar blocks, each
  addable, removable and repeatable on its own rule. Tasks no longer repeat
  themselves, and blocks are optional — a task can be due without being
  scheduled.
- **All-day due dates** for tasks: due on the day, with no clock time.
- **Due markers** in the calendar: a task's due date is flagged on its day even
  when the work is blocked out elsewhere.
- **Calendar right-click menu** on empty space: a new event or task at that
  slot, jump to the day, open the day view.
- **24-hour time** option in Settings, applied to every time label and time
  picker — the calendar, tasks, schedules, quick add, menus and the status bar.
- **`npm run release`**: one command bumps the version in all four places,
  promotes the changelog, runs the tests, builds the platform bundles and
  writes checksums next to them.

### Security

- Backups, history snapshots and exports are written `0600` (the history
  folder itself `0700`); backup folders are validated as absolute existing
  directories, never the disk root, and backup writes are atomic. Restoring a
  snapshot can only read a file inside the configured history folder.
- The packaged webview CSP now also forbids frames, child contexts, workers and
  media, and external links are length- and control-character-checked before
  the shell opens them.

### Fixed

- Tasks stays highlighted in the sidebar when it was opened from a calendar.
- Classes shorter than an hour no longer lose their room in the week view.
- A first launch can no longer fill the sample workspace twice when two windows
  open at once; the second waits instead of duplicating every calendar.

## 0.1.0 — 2026-10-17

First packaged build.

### Added

- Desktop bundles: macOS `.app`/`.dmg`, Windows NSIS installer, Linux `.deb`
  and `.AppImage`, with per-platform config files.
- JSON restore: import a backup and either **merge** it with this device or
  **replace everything**. Export now writes the file through the Rust shell, so
  it works in the packaged app where the webview cancels downloads.
- Persistent storage request so the webview is less likely to evict the
  database.
- External links open in the default browser instead of navigating the app.
- A Content Security Policy for packaged builds (and a relaxed one for dev).
- GitHub Actions release workflow that builds all three platforms on a tag.
- MIT license and this changelog.

### Notes

- Builds are unsigned and Apple Silicon only. macOS needs
  right-click → Open the first time.
- Calendar, tasks, notes and focus all still live in one local database; there
  is no sync between devices.
