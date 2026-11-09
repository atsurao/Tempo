# Tempo on an iPhone

Tempo is one React app with two shells. The desktop build uses the wide,
multi-pane layout; a phone-sized, touch-first viewport gets the mobile shell:
bottom tabs, one view at a time, bottom sheets instead of right-click menus and
a Files-app folder picker for sync. Nothing leaves the device unless you choose
a shared folder.

This guide installs a **personal, unsigned-by-Apple** build on your own iPhone
with a **free Apple ID**. No paid Apple Developer Program membership, App Store
listing, TestFlight or review is involved.

## What you need

- A Mac with **Xcode** installed from the Mac App Store (search for "Xcode").
  Open it once after installing so it can install the iOS platform. Command
  Line Tools alone are not enough: Xcode supplies the iOS SDK and signing.
- About **30 GB of free disk space** for Xcode and the iOS device support.
- An iPhone on **iOS 15 or newer** and a USB cable. (Wi-Fi installs work after
  the first cable pairing, but cable is the reliable first step.)
- A free **Apple ID** signed into Xcode.
- Node 20+, the Rust toolchain, **XcodeGen** and **CocoaPods**:

  ```bash
  brew install xcodegen cocoapods
  ```

- The project's Rust iOS targets. `npm run ios:init` installs them; or run:

  ```bash
  rustup target add aarch64-apple-ios aarch64-apple-ios-sim
  ```

## Free-account limits, before you start

The free "Personal Team" is real code signing, just short-lived:

- The app **stops launching after 7 days**. Reconnect it to the Mac and run
  `npm run ios:install` again to re-sign it. Your data stays in place.
- Only **3 sideloaded apps** can be installed at once per device with a free
  account. Tempo counts as one.
- **Push notifications, iCloud containers, App Groups and background modes**
  are not available to free provisioning. Tempo does not need them: it uses
  local notifications, its own database and a folder you pick in Files.
- There is no way to send the app to someone else's phone this way. This is a
  personal build.

When the seven days are up, do not delete the app to "fix" it — deleting it
deletes its local database. Re-run it from Xcode instead.

## 1. Generate the iOS project (once)

The Xcode project is already generated at
`src-tauri/gen/apple/tempo.xcodeproj`. If you ever need to recreate it after
changing the Tauri config or app icon:

```bash
npm install
npm run ios:init
```

The first run installs the Rust iOS targets and may take a while. It warns
about a missing development team; that is expected and is set in Xcode next.

## 2. Sign in to Xcode with your Apple ID

1. Open Xcode once and let it install its platform components if asked.
2. **Xcode → Settings → Accounts**.
3. Click **+**, choose **Apple ID**, and sign in.
4. Select the account; a **Personal Team** appears on the right.

## 3. Choose the bundle identifier and team

The bundle identifier must be set in the Tauri config. The CLI regenerates the
Xcode project from it, so a change made only in Xcode is overwritten on the
next `ios:run`. Set an iOS-only override in `src-tauri/tauri.ios.conf.json` so
the desktop app keeps its own identity:

```json
{
  "identifier": "com.yourname.tempo"
}
```

`com.tempo.app` is already registered by another team, and automatic signing
refuses it.

Then open the project and set the signing team:

```bash
open src-tauri/gen/apple/tempo.xcodeproj
```

In Xcode:

1. Select the **tempo_iOS** target in the project navigator.
2. Open **Signing & Capabilities**.
3. Tick **Automatically manage signing**.
4. Set **Team** to your name **(Personal Team)**.

## 4. Put the iPhone into developer mode

1. Connect the iPhone with the cable and tap **Trust** on the phone.
2. On the iPhone open **Settings → Privacy & Security → Developer Mode**, turn
   it on, and restart when prompted. (The menu only appears after the phone has
   been connected to Xcode at least once; on newer iOS versions connect, open
   Xcode, then look again.)
3. In Xcode's destination menu (top toolbar), choose your iPhone. If it says
   "unavailable", unlock the phone and wait for the device to finish preparing.

## 5. Install from the terminal

Xcode's **Run** button cannot build this app on its own. Tauri's Xcode build
phase reads its options from a file that exists only while the Tauri CLI is
running, so a plain Run fails with:

```
Command PhaseScriptExecution failed with a nonzero exit code
```

Install from the terminal instead, with the phone connected and unlocked:

```bash
npm run ios:install -- "Your iPhone"
```

Use the name the phone shows in Xcode's device menu. The script builds the web
assets, compiles and signs the app, then installs it with Apple's device tool.
It skips Xcode's IPA export, which fails on Xcode 27 even though the signed app
is fine.

The first build compiles Rust for the phone and can take 5–15 minutes; later
builds are much faster. Re-run the same command after any change, and weekly
when the free profile expires.

To debug in Xcode instead, use `npm run ios:dev -- --open`. That starts the dev
server and the CLI before opening the project, so Run works there too.

If the phone refuses to open it:

- **Settings → General → VPN & Device Management → Developer App → your Apple
  ID → Trust**.
- Launch Tempo again.

## 6. Set up sync with the Mac

Tempo never talks to iCloud, Dropbox or Google Drive itself. It reads and writes
journal files in a folder; the file provider moves those files.

On the **Mac**:

1. Put the folder you want in a file-sharing service. For iCloud Drive, create
   a folder such as `iCloud Drive/Tempo`.
2. Tempo → **Settings → Sync**.
3. **Choose folder…**, pick that folder, then turn **Sync this device through a
   shared folder** on.
4. Leave Tempo open until the first sync finishes.

On the **iPhone**:

1. Install Tempo from Xcode as above.
2. Finish or skip the welcome setup.
3. **More → Settings → Sync**.
4. **Choose folder…** → **Files** → **iCloud Drive** → `Tempo` (or the same
   folder from your other service) → **Open**.
5. Turn sync on.

The iOS picker grants Tempo a security-scoped bookmark, so it keeps access
across launches. If the folder already contains the Mac's workspace, Tempo
asks before replacing the phone's local work. Choose **Join and replace this
device** to adopt the Mac's workspace; Tempo writes a JSON backup first. If the
phone insists on starting a new workspace, you chose the wrong folder or the
Mac never finished its first sync.

Notes:

- iCloud Drive may keep files in the cloud until they are needed. If the folder
  is empty on the phone, open it once in Files and use **Download Now**, or
  keep the folder available offline. The same applies to Dropbox/Drive "online
  only" folders.
- Use the same folder on every device. Tempo writes one device folder per
  install; never copy or merge those folders by hand while sync is on.
- The phone and Mac do not need to be on the same network. They only need the
  file provider to deliver the journal files.

## 7. Backups on the phone

Automatic backups are written to the app's Documents folder, which appears in
**Files → On My iPhone → Tempo → backups** because the iOS bundle declares file
sharing. **Settings → Data** can still list and restore the automatic snapshots
without going through Files. A manual export also lands in that Documents
folder.

## What changes on the phone

Everything on the desktop has a touch equivalent:

- **Bottom tabs** for Today, Calendar, Tasks and Projects; **More** opens Habits,
  Goals, Notes, Focus, the calendar/project/schedule managers and Settings.
  **Settings → Navigation** changes which views sit in the bar (up to four),
  their order, and the desktop sidebar's views and order. Each device keeps its
  own navigation; anything left off the bar stays under More.
- **Edit the bar in place**: long-press any bottom tab to turn the bar into an
  editor. Drag tabs to reorder them, tap the **×** to move one under More, or
  use **Add** to bring another view back; **Done** (or a tap outside) finishes.
- **One view at a time**, full-height editors and bottom sheets. Settings turns
  its sidebar into a horizontal category strip.
- **Section tabs** keep long sheets to one screenful: the item editor splits into
  Details, Blocks (or Repeat) and Notes; Settings → Data and Sync have their own
  sub-tabs; the weekly schedule separates Term, Sessions and Breaks; delegation
  separates Progress, Team and Dependencies; the project team separates Team and
  Add person. Long-press menus keep the everyday actions first and put colour,
  settings and delete behind **More actions**.
- **Long-press** replaces right-click: items, calendar slots, calendars,
  projects and schedules open the same action sheets. Tap a task, note, event
  or Gantt row to open its editor.
- **Tap empty calendar space** to open the slot menu; **tap a month cell** for
  the same menu. Time blocks and events open their editor on tap.
- **Gantt bars are not draggable by touch** (that gesture belongs to scrolling).
  Edit dates in the task editor; resizing and dependency dragging remain on the
  desktop.
- **Drag-to-create** on the calendar becomes tap-to-create. Dragging a task from
  the task list onto the calendar is desktop-only; use the task's **Add block**
  or create a task from a calendar slot instead.

## Troubleshooting

- **"No code signing certificates found"** during `ios:init` is normal. Signing
  happens in Xcode with your Personal Team.
- **Xcode says the bundle identifier is not available**: pick a more unique
  identifier in Signing & Capabilities.
- **`xcodebuild` says it requires Xcode**: Xcode is installed but the command
  line tools still point at the standalone CLT. Run
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- **`Command PhaseScriptExecution failed with a nonzero exit code`**: check
  the line above it in Xcode's log. Two common causes: Xcode was used to build
  directly (Tauri's phase needs the CLI running, so use `npm run ios:install`,
  section 5), or User Script Sandboxing blocks the CLI's options file with
  `Operation not permitted`. The generated project sets
  `ENABLE_USER_SCRIPT_SANDBOXING = NO`; keep it that way for the tempo_iOS
  target.
- **`EXPORT FAILED` or `Couldn't load -exportOptionsPlist`** after a successful
  build: Tauri's IPA export fails on Xcode 27. `npm run ios:install` skips it
  and installs the signed app directly.
- **The Xcode build says `npm: command not found`** (common when Node comes
  from nvm): Xcode's build phase does not read your shell profile. Add your
  Node and Cargo bin folders to the Run Script phase's `PATH`, for example
  `export PATH="$HOME/.nvm/versions/node/<version>/bin:$HOME/.cargo/bin:$PATH"`.
- **`pod install` fails**: run `brew install cocoapods`, then `npm run ios:init`
  again. No `sudo` is needed with Homebrew.
- **The phone does not appear in Xcode**: unlock it, trust the computer, and
  check the cable. A restart of both Xcode and the phone clears most cases.
- **Sync says the folder is unavailable**: in Files, make sure the provider is
  signed in and the folder is downloaded; then choose it again in Tempo.
- **The app stopped opening after a week**: reconnect the phone and run
  `npm run ios:install` again. Do not delete the app, or its local database
  goes with it.
