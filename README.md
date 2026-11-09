# Tempo

A calm, local-first day planner: calendar, tasks, notes and focus in one place.
Built as a Tauri desktop app with a React + TypeScript frontend.

## Run it

```bash
npm install

npm run dev        # browser at http://127.0.0.1:1420
npm run desktop    # native desktop window (Tauri)
npm run desktop:build  # packaged .app / .dmg in src-tauri/target/release/bundle
```

Requires Node 20+ and, for the desktop shell, the Rust toolchain.

The dev watcher polls for changes rather than using native file events: creating
an FSEvents watch inside an iCloud-synced `~/Documents` blocks on the parent
folder and the server never starts. On an ordinary local disk, set
`VITE_WATCH_FSEVENTS=1` to switch back to native events.

## Install

Builds are unsigned, so each platform shows its own "are you sure?" prompt once:

- **macOS** — open the `.dmg`, drag Tempo to Applications, then right-click
  Tempo → Open the first time. If macOS refuses outright, run
  `xattr -dr com.apple.quarantine /Applications/Tempo.app`. Builds are
  Apple Silicon only; Intel Macs need a universal build.
- **Windows** — run the NSIS `.exe`. SmartScreen warns about an unknown
  publisher; "More info" → "Run anyway". Installs per user, no admin prompt.
- **Linux** — the `.AppImage` runs anywhere (`chmod +x` first); the `.deb` is for
  Debian and Ubuntu.

Signatures are the only thing missing for a frictionless download. A Developer
ID, notarization and an Authenticode certificate are a separate step that only
matters once this is shared publicly.

## On an iPhone

The same frontend has a phone shell: bottom tabs, one view at a time, bottom
sheets for menus, tap-to-open rows and the iOS Files picker for the sync folder.
An iOS Xcode project lives at `src-tauri/gen/apple/tempo.xcodeproj` (the Tauri
config is [tauri.ios.conf.json](src-tauri/tauri.ios.conf.json)).

```bash
npm run ios:init   # once, installs Rust targets and (re)generates the Xcode project
open src-tauri/gen/apple/tempo.xcodeproj
```

Sign the `tempo_iOS` target with your free Apple ID's Personal Team and press
Run. No paid developer account is needed, but the build expires after seven days
and has to be re-run from Xcode. The step-by-step guide, including the
free-account limits and shared-folder sync setup, is in
[docs/iphone.md](docs/iphone.md).

## Build installers

```bash
npm run desktop:build
```

The bundle type is chosen per platform, so the same command works everywhere:

| Platform | Artifact | Config |
| --- | --- | --- |
| macOS | `.app` + `.dmg` | [tauri.macos.conf.json](src-tauri/tauri.macos.conf.json) |
| Windows | NSIS `.exe` (per user) | [tauri.windows.conf.json](src-tauri/tauri.windows.conf.json) |
| Linux | `.deb` + `.AppImage` | [tauri.linux.conf.json](src-tauri/tauri.linux.conf.json) |

Output lands in `src-tauri/target/release/bundle`. You can only build for the
platform you are on; the repository-level `.github/workflows/release.yml` builds all three on a tag
(or by hand) and attaches the artifacts to a draft release.

## Cut a release

```bash
npm run release -- patch     # 0.1.0 -> 0.1.1, or: minor / major / 1.4.2
npm run release -- patch --dry-run
```

The version is written in four places, so the script edits them together:
`package.json`, `package-lock.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` (plus its lockfile entry). It promotes the changelog's
`## Unreleased` section to the new number and date, refuses to run if those
versions already disagree, then runs `npm test` and builds this platform's
bundles. Artifacts keep Tauri's versioned names (`Tempo_0.1.1_aarch64.dmg`), and
a `SHA256SUMS-<version>.txt` is written next to them.

Nothing is committed, tagged or pushed: the script prints the `git add`,
`commit`, `tag` and `push` commands to run once the diff looks right. Pushing
the tag starts the cross-platform draft release. A run interrupted after the
bump can be retried with the same version and it picks up at the build.

OrbStack/Docker images and the exact toolchain per platform are the only
remaining setup — Windows needs the WebView2 bootstrapper (the installer
downloads it), Linux needs `libwebkit2gtk-4.1-dev` and `libappindicator3-dev`.

## The idea

An event is time already claimed; a task is time you haven't placed yet.
Both live in one `items` table, so a task dragged onto the calendar is still a
task, and completing it in the list updates the calendar immediately.

## What works

**Calendar** — year / month / week / day / agenda views, drag to create, drag to move,
drag the bottom edge to resize, all-day and multi-day events, overlapping-event
lanes, a live "now" line, and drag a task from the list onto any day or time.
The **week** is one continuous strip of days: the seven days of the current week fit
the pane exactly at the standard zoom, and sideways scrolling carries on through the
weeks without a wall, loading more days at either end as you approach it. The **month**
is a continuous vertical stack of months that scrolls through them into the next year
and the one after; the **day** is fixed to a single day and only scrolls through its
hours. Day headers, goals and the all-day row stay pinned while the hours move. The
**year** is one page per year that snaps to a stop on each one, under a heading that
names the year you are on. Reaching either end of the loaded window shows a loading
note and slides the window along by three years, so the next few years are already
there by the time you arrive.

A calendar can be hidden without editing it: the eye on its sidebar row, or
**Hide calendar** in its right-click menu, takes its events and goals out of the
grid, month, year and agenda at once, and its tasks out of the task list, board,
timeline, Today and the status bar's counts — one filter the calendar, the task
views and the Today pane all read. The calendar stays in the sidebar, dimmed
with the eye showing, and clicking it still shows its tasks (an explicit filter
beats hiding), so nothing becomes unreachable. Hidden work is not silent: Tasks
and Today show a small **N open tasks hidden · calendar** note, and
Settings → Tasks → **Persistent overdue** keeps work that is already late on
screen even when its calendar is hidden. Timetables hide the same way: the eye
on a schedule's row takes its sessions out of the calendar, Today and the
counts while leaving the term, its breaks and its editor intact. Calendars,
projects and schedules can also be dragged within their own sidebar list, using
the same drag as the view buttons; the order is saved with each row, so a
reload opens the lists the way they were left. Every toggle is
undoable from the toast.

Every view has its own zoom: the `−` / percentage / `+` controls in the calendar pane
header, or `+`, `−` and `0` from the keyboard (0 is fit). Arrow keys move a period at
a time, ↑/↓ scroll the view, PageUp/PageDown scroll a screen, Home jumps to today, and
`D W M Y A` switch views. A sideways pan in the week view settles on the nearest
day, just as the month view settles on the nearest week. Right-clicking empty
space (or long-pressing it on a phone) offers a new event or task at that slot,
and a task's due date is flagged
wherever it falls — even when the work itself is blocked out on another day.
Event recurrence supports daily/weekly/monthly/yearly, intervals, weekday
selection, end dates or counts, with per-occurrence edits ("this occurrence",
"this and following", "all events") and per-occurrence deletes.

**Schedules** — a weekly timetable for a whole term: sessions on chosen weekdays,
breaks that pause them, a term strip and a breaks-by-month view. Hiding one hides
its sessions everywhere the calendar is drawn, and showing it brings the term
straight back.

**Tasks** — calendars for grouping and color, tags, priorities, estimates, nested
subtasks with roll-up progress, due dates either at a time or all day, list,
board and timeline views, filters, and soft delete with undo. A task may hold
several **time blocks** — each one addable, removable and repeatable on its own
rule — and needs none of them: a task can be due without ever being scheduled.
The task itself never repeats; only its blocks do. Each calendar
group folds open and shut from its header — a folded group still shows its
overdue tasks, with the rest counted underneath — and work that is past due
gets a folded-corner marker with its date and time in red. Hiding a calendar
leaves its overdue tasks visible when **Persistent overdue** is on, and a count
of what is still hidden sits above the list.

**Habits** — a separate category for things done again and again, never
"finished": reading, practice, a walk. Each habit repeats on chosen weekdays,
every week or every few, and is checked off one day at a time. The pane shows
today's habits first, the last seven days, a streak that survives the morning it
has not been ticked yet, and a 30-day completion rate; archive one to keep its
history without it on the list. Today carries the day's habits too, as a card
under **Next up**, so they are ticked off without opening the pane.

**Projects** — a plan, separate from a calendar: start and deadline, working
days, a task outline and progress. The Projects view opens on an index of plans,
then a detail page with the same list and board used by Tasks, plus a Gantt. The
Gantt keeps an indented outline beside the timeline, rolls summary bars up from
subtasks, marks milestones and finish-to-start links, and scales continuously
with a single slider. Dragging a leaf bar or milestone pins its new dates as a
manual task; dragging either edge resizes the working-day duration. A leaf's
link dot draws a finish-to-start link to another row, and clicking a link opens
its lag and delete controls; dragging either endpoint retargets the link. Links
that would close a loop are refused. The scheduler moves dependent work and
redraws the links either way. Tasks created there carry their project
membership into the editor, and the header shows the scheduler's computed
finish and any deadline or dependency conflicts.

Every project task has a **delegation card**, separate from the task editor and
opened from the person icon on a list row or board card (or from the right-click
quick look). It sets completion percentage and status, marks a milestone, assigns
people from the project roster, and adds finish-to-start blockers or successors
with lag counted in working days. The team pill in the project header manages the
roster itself; removing someone from the team also clears their assignments.

**Collections** — click the **Calendars**, **Projects** or **Schedules** heading in
the sidebar to open a card index of that collection. The cards summarise each
calendar, plan or timetable; clicking a calendar or schedule jumps to the week of
its next item and briefly rings that collection's entries, while a project card
opens the plan. Right-click any card for the same actions as its sidebar row.

**Notes** — markdown editor with preview, daily note, autosave.

**Focus** — pomodoro/break timer, task attachment, session log, daily total.

**Today** — opens full-window on launch; next up with countdown, a habits card
holding today's habits and their streaks, the day's timeline, due and overdue
tasks, and a focus queue of unscheduled work.

**Goals** — the long arc, kept apart from tasks and events. A goal is either a
month long, a year long, or open-ended (**until completion**). Day and week views
give goals their own fold-out **Goals** row above the all-day line, listing the
goals running through that day or week; month and year views mark only the day a
goal falls due (open goals have no deadline, so they get no calendar marker). The
agenda keeps a goals block at the top, and the tasks timeline gives goals their
own rows above the task bars. Completing a goal takes it out of both views and
files it under Completed.

**Everywhere** — right-click any task or event for a quick look with open,
complete and delete; right-click a calendar for show, hide, color, settings and a
confirmed delete; right-click a project for open, new task, team, color, archive
and restore; and right-click a schedule for open, show on calendar, hide, color,
breaks and a confirmed delete. `⌘K` command palette with fuzzy search and natural-language
creation ("chem lab fri 2pm for 90m #exam !1"), reminders with in-app toasts and
desktop notifications, layout presets, resizable panes, a collapsible sidebar
(open by default, folding to an icon strip where each view's name appears on
hover and the calendars become one icon with a flyout list, and draggable
between a minimum and maximum width), editable pane titles,
accent/density/corner theming, dark mode by default with a settings toggle (and an
optional follow-system mode), and JSON backup and restore.

## Shortcuts

| Action | Key |
| --- | --- |
| Search / commands | `⌘K` |
| New task | `N` |
| New event | `E` |
| New goal | `G` |
| Quick add | `Q` |
| Jump to today | `T` |
| Previous / next period | `[` / `]` |
| Save editor | `⌘↵` |
| Close | `Esc` |

## First run

A new install opens a short setup flow before the workspace appears: pick a
theme, accent and clock, choose where backups go, then start blank, restore an
automatic snapshot or a Tempo JSON backup, or import `.ics` calendars (each one
gets a name and colour).
The welcome card names the build on every launch; it can be switched off from that card or from Settings →
Appearance → **Welcome screen**, and the flow can be replayed from Settings →
Data → **Run setup again** without touching any work.

The default backup folder is `backups/` inside the app's own data directory
(`~/Library/Application Support/com.tempo.app` on macOS). Any folder can be
chosen instead, including an iCloud Drive, Dropbox or OneDrive folder, so a
copy syncs off the machine without Tempo talking to a network service.

## Data

Everything is stored in IndexedDB on this device (database `tempo`). UI
preferences live in `localStorage`. There is no server and nothing leaves the
machine unless you point backups at a synced folder.

**Automatic backups.** After a burst of edits settles (about eight seconds),
the whole workspace is written to `tempo-autosave.json` in the chosen folder,
with the previous copy rotated to `tempo-autosave.previous.json`. Writes are
atomic (temp file + rename) and the files are `0600`, readable only by your
account. Settings → Data shows the folder, the last save and a **Back up now**
button; turning automatic backups off leaves manual export untouched.

**Backup history.** Beside the rolling file, Tempo keeps an hourly snapshot in
`tempo-history/` for two weeks — at most 336 files and 150 MB, dropping the
oldest first if either ceiling is reached. Settings → Data → **Backup history**
searches those snapshots by name, date or time, previews what one holds, and
restores it. A snapshot of the workspace being replaced is written first, so a
restore is itself undoable. Snapshots are `0600` and pruned by the native side.

Settings → **Export JSON** writes a complete backup (`items`, calendars, goals,
schedules, work projects, members, task links, tags, habits and focus sessions).
In the desktop shell the file goes to `~/Downloads` and the path is shown in a
toast, because the WKWebView cancels `download` anchors; in a browser it
downloads normally.

Settings → **Import** reads that file back. *Merge* keeps what is already here
and lets the file win on conflicts; *Replace everything* deletes the local
database first, so the device matches the file exactly. First-run setup offers
**Restore a backup**: it lists the automatic snapshots in the backup folder,
newest first, so a new install or a reset can be repopulated without locating a
JSON file; an exported file can still be chosen instead.

**Folder sync.** Settings → Sync points Tempo at a local folder that a
file-sharing app already keeps in step between devices. Tempo writes
per-device journal files there and reads files the other devices wrote; it never
connects to iCloud, Dropbox or another service, and the service controls upload
and download timing. The folder can be inside iCloud Drive, Dropbox, Google
Drive, OneDrive, Syncthing or a network share. An empty folder starts a new
workspace, an empty device joins the existing one, and local work on both sides
requires an explicit **Join** or **Start a new workspace** choice. JSON backups
remain the portable snapshot format. The design and merge rules are in
[docs/folder-sync.md](docs/folder-sync.md).

Naming: the grouping shown as a **calendar** in the UI is stored as
`Project`/`projectId` in the database and in the exported JSON, so older backups
and the schema itself stay valid.

Goals live in their own `goals` table (`Goal` type) rather than in `items`, so
the calendar, task and note code paths are untouched by them. A goal records its
`span` (`month`, `year` or `open`) and the `start` day; the end date is derived
from the span unless the goal was given one, and `open` goals deliberately have
none.

Work projects are their own tables: `workProjects` (name, start, deadline,
working days, roster), `members` (local people, not accounts) and
`taskDependencies` (finish-to-start links with lag). Tasks join a project through
`Item.workProjectId` and keep two date pairs apart: `start`/`end` is where the
task sits on the calendar, while `plannedStart`/`plannedEnd` is the Gantt plan.
Delegation state stays on the task (`assigneeIds`, `progressPct`, `milestone`),
while roster membership belongs to the project; removing a member clears their
assignments but leaves the tasks themselves untouched.
The pure scheduler in `lib/projectSchedule.ts` computes the plan from working
days, dependencies, pins, milestones and deadlines; it never rewrites calendar
placement. Backups are written as `version: 5`; version 1–4 files still import,
with the collections they predate arriving empty. On every upgrade the existing
database is migrated in place — nothing is re-seeded and nothing is lost.

Settings → **Import .ics** reads a calendar exported from Google, Apple, Outlook
or Fastmail. Repeating events arrive as series (with their excluded dates and
moved occurrences), all-day events keep their span, todos become tasks with due
dates, alarms become reminders, and categories become tags. Entries are matched
by their iCalendar UID, so importing the same file twice adds nothing the second
time, and the result can be undone from the same panel.

To start over, open Settings → Data → **Reset all data**. Two confirmations
stand in front of the delete — the second asks for the word `RESET` — and the
first offers to save a JSON backup. Reset clears the IndexedDB workspace and
the `localStorage` UI preferences, then reopens setup with an empty workspace;
backup files already written to disk are left alone. For development, deleting
the `tempo` database in devtools → Application → IndexedDB also empties the
workspace, but leaves the UI preferences behind.

### Local security

Tempo has no account, no telemetry and no network calls of its own. The
packaged webview runs under a strict CSP (`default-src 'self'`, no frames,
workers or remote scripts) with only the notification and folder-picker
capabilities enabled. Backups and exports are written `0600` through Rust,
which also validates the chosen folder (absolute, existing, not the disk root)
and refuses names that escape it. Markdown escapes all note content before
rendering, and external links are limited to `http(s)` before the shell hands
them to the browser. The local database is protected by the OS user account
(and FileVault if enabled); backups inherit the permissions of the folder you
choose, so a shared cloud folder is only as private as that folder.

## Checking the UI (dev)

With `npm run dev` running, the browser console exposes a geometry probe. It
returns JSON instead of a screenshot:

```js
__tempoProbe({
  scope: ".popover.topbar-popover",
  alignTo: 'button[title="Layout"]',
  align: "right",
  matchWidth: false,
});
```

It reports floating elements outside the viewport, menu rows that overlap or
spill their own height, popovers clipped by an ancestor, interactive elements
whose center is covered by something else, and optional edge/width alignment
against a reference element. `scope` defaults to the whole page, and `rows`
defaults to `[role="option"], .menu-item`. The probe is loaded by the dev server
only and is not in the production bundle.

## Layout

```
src/
  components/
    calendar/   YearView, MonthView, TimeGrid (week/day), AgendaView, CalendarView
    tasks/      TaskPane, TaskRow, TaskBoard, QuickAddBar
    projects/   ProjectsPane, ProjectCreateForm, ProjectGantt
    goals/      GoalsPane (the goals page)
    today/      TodayPane
    notes/      NotesPane
    focus/      FocusPane
    editor/     ItemEditor, GoalEditor, RecurrenceField, CommandPalette,
                SettingsModal
    shell/      AppBar, SideRail, PaneLayout, PaneFrame, StatusBar, Toasts
  db/           Dexie schema, CRUD helpers, seed data, live-query hooks
  lib/          recurrence, occurrences, nlp, tasks, date, markdown, fuzzy,
                notify, ics (iCalendar reader), icsImport (plan + apply),
                goals (spans, coverage, progress), projects (membership and
                progress), projectSchedule (working-day plan), gantt (outline
                rows, milestones and date ranges), backup (JSON parse + restore),
                desktop (save file, open links)
  hooks/        useIsMobile, useLongPress, useTimeFormat, useReminders
  store/        ui (zustand + persist), nav
  styles/       tokens, base, shell, calendar, tasks, projects, goals, panels,
                editor, mobile
scripts/        release.mjs — version bump, changelog, tests, bundles, checksums
src-tauri/      Rust shell (save_export, write_auto_backup, open_external,
                reveal_path, sync folder bridge), window and CSP config, icons,
                notification, dialog and scoped-storage plugins, Info.ios.plist,
                per-platform bundle config, gen/apple Xcode project
.github/        release workflow for macOS, Windows and Linux
```

## Known gaps

- Free-form drag-anywhere panes are not built yet; panes resize and presets work.
- Recurrence "this and following" splits are implemented but only smoke-tested.
- No `.ics` export and no PWA install. Folder sync runs in the desktop and iOS
  shells; browser builds keep their own local database.
- Builds are unsigned and macOS builds are arm64-only for now.
- The mobile shell is iPhone-first. iPad uses the same single-pane touch layout
  rather than the desktop columns; Android has no project setup yet.
- An iOS install needs Xcode. With a free Apple ID it expires after seven days
  and has to be re-signed; [docs/iphone.md](docs/iphone.md) covers the steps.
- Importing does not merge into an existing series; a changed file adds new
  entries rather than updating the ones already stored.
- Goals are a plan, not a tracker: they carry no progress of their own, so the
  bar on a goal row is elapsed time, not work completed. Linking tasks to a goal
  is not built yet.
- The project Gantt edits finish-to-start links, but only that dependency type;
  member assignment and Calendar/Today milestone rows are the next slice.
- Native notifications require permission on first use (Settings → Notifications).
