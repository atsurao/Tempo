mod sync_folder;

use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use sync_folder::{
  sync_delete_batch, sync_delete_snapshot, sync_list_batches, sync_list_devices,
  sync_list_snapshots, sync_read_batch, sync_read_meta, sync_read_snapshot,
  sync_read_workspace, sync_set_device, sync_set_folder, sync_status, sync_write_batch,
  sync_write_meta, sync_write_snapshot, sync_write_workspace, SyncFolderState,
};
use tauri::Manager;

/// Every file Tempo writes holds personal data, so it is capped and private.
const MAX_TEXT_BYTES: usize = 64 * 1024 * 1024;
const AUTO_BACKUP_NAME: &str = "tempo-autosave.json";
const AUTO_BACKUP_PREVIOUS: &str = "tempo-autosave.previous.json";

/// Searchable snapshots live beside the rolling backup, one folder down.
/// Two weeks of hourly snapshots is at most 336 files; the byte ceiling keeps
/// a large workspace from turning history into bulk storage.
const HISTORY_DIR: &str = "tempo-history";
const HISTORY_PREFIX: &str = "tempo-";
const HISTORY_KEEP_MS: u128 = 14 * 24 * 60 * 60 * 1000;
const HISTORY_MAX_FILES: usize = 336;
const HISTORY_MAX_BYTES: u64 = 150 * 1024 * 1024;
const HISTORY_PARSE_BYTES: u64 = 16 * 1024 * 1024;
const HISTORY_TITLES: usize = 120;

/// Keep a suggested name to a single, safe file name inside the target folder.
fn sanitize_name(name: &str) -> String {
  let base = name
    .rsplit(['/', '\\'])
    .next()
    .unwrap_or("tempo-backup.json")
    .chars()
    .filter(|c| !c.is_control() && *c != ':' && *c != '*')
    .take(120)
    .collect::<String>();
  let base = base.trim().trim_start_matches('.').to_string();
  if base.is_empty() {
    "tempo-backup.json".into()
  } else if Path::new(&base).extension().is_none() {
    format!("{base}.json")
  } else {
    base
  }
}

/// `name (1).json` next to an existing file, rather than overwriting it.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
  let candidate = dir.join(name);
  if !candidate.exists() {
    return candidate;
  }
  let path = Path::new(name);
  let stem = path
    .file_stem()
    .map(|s| s.to_string_lossy().to_string())
    .unwrap_or_else(|| "tempo-backup".into());
  let ext = path
    .extension()
    .map(|s| format!(".{}", s.to_string_lossy()))
    .unwrap_or_default();
  let mut counter = 1;
  loop {
    let next = dir.join(format!("{stem} ({counter}){ext}"));
    if !next.exists() {
      return next;
    }
    counter += 1;
  }
}

/// Write a file only the signed-in user can read.
///
/// A Tempo export is the whole workspace: names, notes, locations and calendar
/// history. On unix it is created (and re-chmodded) as 0600 rather than the
/// umask default, so a shared machine or a synced folder does not expose it.
fn write_private(path: &Path, contents: &str) -> Result<(), String> {
  let mut options = std::fs::OpenOptions::new();
  options.write(true).create(true).truncate(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  let mut file = options
    .open(path)
    .map_err(|e| format!("could not write {}: {e}", path.display()))?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    // `mode` only applies on create; an existing file keeps its old bits.
    file
      .set_permissions(std::fs::Permissions::from_mode(0o600))
      .map_err(|e| format!("could not protect {}: {e}", path.display()))?;
  }
  file
    .write_all(contents.as_bytes())
    .and_then(|_| file.sync_all())
    .map_err(|e| format!("could not write {}: {e}", path.display()))
}

fn now_ms() -> u128 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0)
}

fn modified_ms(meta: &std::fs::Metadata) -> u128 {
  meta
    .modified()
    .ok()
    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
    .map(|d| d.as_millis())
    .unwrap_or(0)
}

/// History holds the same personal data as the rolling copy, so the folder is
/// owner-only as well as the files inside it.
fn create_private_dir(dir: &Path) -> Result<(), String> {
  std::fs::create_dir_all(dir)
    .map_err(|e| format!("could not open {}: {e}", dir.display()))?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
      .map_err(|e| format!("could not protect {}: {e}", dir.display()))?;
  }
  Ok(())
}

fn write_export(dir: &Path, name: &str, contents: &str) -> Result<String, String> {
  if contents.len() > MAX_TEXT_BYTES {
    return Err("that file is too large to export".into());
  }
  std::fs::create_dir_all(dir).map_err(|e| format!("could not open {}: {e}", dir.display()))?;
  let target = unique_path(dir, &sanitize_name(name));
  write_private(&target, contents)?;
  Ok(target.display().to_string())
}

/// Write an export to a folder the user can find again and report the path.
///
/// WKWebView cancels `download` anchors, so a blob download never reaches the
/// disk in the packaged app. Downloads first, app data as a fallback.
#[tauri::command]
fn save_export(app: tauri::AppHandle, name: String, contents: String) -> Result<String, String> {
  // iOS has no Downloads folder. Documents is the folder its Files app can
  // expose (see Info.ios.plist), so a manual export still lands somewhere the
  // reader can find it.
  let dir = app
    .path()
    .download_dir()
    .or_else(|_| app.path().document_dir())
    .or_else(|_| app.path().app_data_dir())
    .map_err(|e| format!("no writable folder: {e}"))?;
  write_export(&dir, &name, &contents)
}

#[cfg(target_os = "macos")]
fn open_in_browser(url: &str) -> std::io::Result<()> {
  std::process::Command::new("open").arg(url).spawn().map(|_| ())
}

#[cfg(target_os = "windows")]
fn open_in_browser(url: &str) -> std::io::Result<()> {
  std::process::Command::new("explorer").arg(url).spawn().map(|_| ())
}

#[cfg(all(
  unix,
  not(target_os = "macos"),
  not(target_os = "ios"),
  not(target_os = "android")
))]
fn open_in_browser(url: &str) -> std::io::Result<()> {
  std::process::Command::new("xdg-open").arg(url).spawn().map(|_| ())
}

#[cfg(any(target_os = "ios", target_os = "android"))]
fn open_in_browser(_url: &str) -> std::io::Result<()> {
  Err(std::io::Error::new(
    std::io::ErrorKind::Unsupported,
    "no external browser on this platform",
  ))
}

/// Hand an http(s) link to the default browser instead of the webview.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
  if url.len() > 4096 {
    return Err("that link is too long".into());
  }
  if url.chars().any(|c| c.is_control()) {
    return Err("that link is not valid".into());
  }
  if !(url.starts_with("http://") || url.starts_with("https://")) {
    return Err("only http(s) links can be opened".into());
  }
  open_in_browser(&url).map_err(|e| e.to_string())
}

/// A folder the user picked is the only place automatic backups may write.
///
/// It has to be absolute, has to exist afterwards and can never be the root of
/// the disk, so a bad or hostile string cannot turn into a write anywhere on
/// the machine. The canonical path is returned, which also resolves symlinks
/// such as the ones iCloud Drive and Dropbox use for their folders.
fn validate_folder(folder: &str, create: bool) -> Result<PathBuf, String> {
  if folder.trim().is_empty() {
    return Err("choose a backup folder first".into());
  }
  if folder.chars().any(|c| c.is_control()) {
    return Err("that folder path is not valid".into());
  }
  let raw = PathBuf::from(folder);
  if !raw.is_absolute() {
    return Err("the backup folder must be a full path".into());
  }
  if create {
    std::fs::create_dir_all(&raw)
      .map_err(|e| format!("could not open {}: {e}", raw.display()))?;
  }
  let path = raw
    .canonicalize()
    .map_err(|e| format!("could not open {}: {e}", raw.display()))?;
  if !path.is_dir() {
    return Err("the backup location is not a folder".into());
  }
  if path.parent().is_none() {
    return Err("choose a folder other than the root of the disk".into());
  }
  Ok(path)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupReceipt {
  path: String,
  bytes: usize,
  written_at: u128,
}

/// Replace the rolling automatic backup, keeping the previous copy.
///
/// Written to a temp file in the same folder and renamed into place, so a
/// crash mid-write can never leave a half-written backup behind. The older
/// backup is rotated to `tempo-autosave.previous.json` first.
#[tauri::command]
fn write_auto_backup(folder: String, contents: String) -> Result<BackupReceipt, String> {
  if contents.len() > MAX_TEXT_BYTES {
    return Err("the workspace is too large for one backup file".into());
  }
  let dir = validate_folder(&folder, true)?;
  let target = dir.join(AUTO_BACKUP_NAME);
  let previous = dir.join(AUTO_BACKUP_PREVIOUS);
  let written_at = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0);
  let temp = dir.join(format!(".{AUTO_BACKUP_NAME}.{}.{written_at}.tmp", std::process::id()));

  write_private(&temp, &contents)?;
  if target.exists() {
    let _ = std::fs::remove_file(&previous);
    std::fs::rename(&target, &previous)
      .map_err(|e| format!("could not rotate the previous backup: {e}"))?;
  }
  if let Err(e) = std::fs::rename(&temp, &target) {
    let _ = std::fs::remove_file(&temp);
    return Err(format!("could not replace the backup: {e}"));
  }

  Ok(BackupReceipt {
    path: target.display().to_string(),
    bytes: contents.len(),
    written_at,
  })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotReceipt {
  path: String,
  bytes: usize,
  written_at: u128,
}

/// What the history list needs without loading a whole workspace per row:
/// when it was taken, how much it holds, and enough names to search it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
  path: String,
  written_at: u128,
  bytes: u64,
  items: usize,
  calendars: usize,
  goals: usize,
  habits: usize,
  schedules: usize,
  projects: usize,
  titles: Vec<String>,
}

fn collect_titles(
  value: &serde_json::Value,
  key: &str,
  field: &str,
  limit: usize,
  titles: &mut Vec<String>,
) {
  let Some(rows) = value.get(key).and_then(|entry| entry.as_array()) else {
    return;
  };
  for row in rows.iter().take(limit) {
    if titles.len() >= HISTORY_TITLES {
      break;
    }
    let Some(text) = row.get(field).and_then(|value| value.as_str()) else {
      continue;
    };
    let text = text.trim();
    if text.is_empty() {
      continue;
    }
    titles.push(text.chars().take(80).collect());
  }
}

fn history_entry(path: &Path, meta: &std::fs::Metadata) -> HistoryEntry {
  let mut entry = HistoryEntry {
    path: path.display().to_string(),
    written_at: modified_ms(meta),
    bytes: meta.len(),
    items: 0,
    calendars: 0,
    goals: 0,
    habits: 0,
    schedules: 0,
    projects: 0,
    titles: Vec::new(),
  };
  // A huge snapshot still appears in the list, just without a search index.
  if meta.len() > HISTORY_PARSE_BYTES {
    return entry;
  }
  let Ok(text) = std::fs::read_to_string(path) else {
    return entry;
  };
  let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
    return entry;
  };
  let count = |key: &str| {
    value
      .get(key)
      .and_then(|entry| entry.as_array())
      .map(|rows| rows.len())
      .unwrap_or(0)
  };
  entry.items = count("items");
  entry.calendars = count("projects");
  entry.goals = count("goals");
  entry.habits = count("habits");
  entry.schedules = count("schedules");
  entry.projects = count("workProjects");
  collect_titles(&value, "items", "title", 60, &mut entry.titles);
  collect_titles(&value, "projects", "name", 20, &mut entry.titles);
  collect_titles(&value, "workProjects", "name", 20, &mut entry.titles);
  collect_titles(&value, "goals", "title", 15, &mut entry.titles);
  collect_titles(&value, "schedules", "name", 10, &mut entry.titles);
  collect_titles(&value, "habits", "name", 10, &mut entry.titles);
  entry
}

/// Drop history that has aged out, or that would push the folder past its
/// count/byte ceiling. Newest snapshots win; removal is best effort.
fn prune_history_to(dir: &Path, now: u128, keep_ms: u128, max_files: usize, max_bytes: u64) {
  let Ok(read) = std::fs::read_dir(dir) else {
    return;
  };
  let mut files: Vec<(PathBuf, u128, u64)> = Vec::new();
  for item in read.flatten() {
    let path = item.path();
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
      continue;
    };
    // An interrupted write may leave a hidden temp file behind.
    if name.starts_with('.') {
      if name.ends_with(".tmp") {
        if let Ok(meta) = item.metadata() {
          if now.saturating_sub(modified_ms(&meta)) > 24 * 60 * 60 * 1000 {
            let _ = std::fs::remove_file(&path);
          }
        }
      }
      continue;
    }
    if !name.starts_with(HISTORY_PREFIX)
      || path.extension().and_then(|ext| ext.to_str()) != Some("json")
    {
      continue;
    }
    if let Ok(meta) = item.metadata() {
      if meta.is_file() {
        files.push((path, modified_ms(&meta), meta.len()));
      }
    }
  }
  files.sort_by(|a, b| b.1.cmp(&a.1));

  let mut kept = 0usize;
  let mut bytes = 0u64;
  for (path, written_at, size) in files {
    let fresh = now.saturating_sub(written_at) <= keep_ms;
    if !fresh || kept >= max_files || bytes.saturating_add(size) > max_bytes {
      let _ = std::fs::remove_file(&path);
      continue;
    }
    kept += 1;
    bytes += size;
  }
}

fn prune_history(dir: &Path, now: u128) {
  prune_history_to(
    dir,
    now,
    HISTORY_KEEP_MS,
    HISTORY_MAX_FILES,
    HISTORY_MAX_BYTES,
  );
}

/// Keep a timestamped copy of the workspace for the history browser.
#[tauri::command]
fn write_backup_snapshot(folder: String, contents: String) -> Result<SnapshotReceipt, String> {
  if contents.len() > MAX_TEXT_BYTES {
    return Err("the workspace is too large for one history snapshot".into());
  }
  let dir = validate_folder(&folder, true)?.join(HISTORY_DIR);
  create_private_dir(&dir)?;

  let written_at = now_ms();
  let target = dir.join(format!("{HISTORY_PREFIX}{written_at}.json"));
  let temp = dir.join(format!(
    ".{HISTORY_PREFIX}{written_at}.{}.tmp",
    std::process::id()
  ));
  write_private(&temp, &contents)?;
  if let Err(e) = std::fs::rename(&temp, &target) {
    let _ = std::fs::remove_file(&temp);
    return Err(format!("could not keep the history snapshot: {e}"));
  }
  prune_history(&dir, written_at);

  Ok(SnapshotReceipt {
    path: target.display().to_string(),
    bytes: contents.len(),
    written_at,
  })
}

/// Snapshots from the last two weeks, newest first, with a small title index.
#[tauri::command]
fn list_backup_history(folder: String) -> Result<Vec<HistoryEntry>, String> {
  let dir = validate_folder(&folder, false)?.join(HISTORY_DIR);
  if !dir.is_dir() {
    return Ok(Vec::new());
  }
  let now = now_ms();
  // Browsing is also a chance to drop anything that aged out while the app
  // was closed; failures are ignored and the list still opens.
  prune_history(&dir, now);
  let mut entries = Vec::new();
  let read = std::fs::read_dir(&dir)
    .map_err(|e| format!("could not open {}: {e}", dir.display()))?;
  for item in read.flatten() {
    let path = item.path();
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
      continue;
    };
    if !name.starts_with(HISTORY_PREFIX)
      || path.extension().and_then(|ext| ext.to_str()) != Some("json")
    {
      continue;
    }
    let Ok(meta) = item.metadata() else {
      continue;
    };
    if !meta.is_file() || now.saturating_sub(modified_ms(&meta)) > HISTORY_KEEP_MS {
      continue;
    }
    entries.push(history_entry(&path, &meta));
  }
  entries.sort_by(|a, b| b.written_at.cmp(&a.written_at));
  entries.truncate(HISTORY_MAX_FILES);
  Ok(entries)
}

/// Read one snapshot back for the restore preview. Only files that live in the
/// chosen folder's history directory can be read, whatever path arrived over
/// IPC, and they are size-capped like every other import.
#[tauri::command]
fn read_backup_snapshot(folder: String, path: String) -> Result<String, String> {
  let root = validate_folder(&folder, false)?
    .join(HISTORY_DIR)
    .canonicalize()
    .map_err(|e| format!("could not open the backup history: {e}"))?;
  let target = PathBuf::from(&path)
    .canonicalize()
    .map_err(|e| format!("could not open that snapshot: {e}"))?;
  if !target.starts_with(&root) {
    return Err("that snapshot is outside the backup history".into());
  }
  let name = target
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or_default();
  if !name.starts_with(HISTORY_PREFIX) {
    return Err("that file is not a history snapshot".into());
  }
  let meta = std::fs::metadata(&target)
    .map_err(|e| format!("could not open that snapshot: {e}"))?;
  if !meta.is_file() {
    return Err("that snapshot is not a file".into());
  }
  if meta.len() > MAX_TEXT_BYTES as u64 {
    return Err("that snapshot is too large to open".into());
  }
  std::fs::read_to_string(&target)
    .map_err(|e| format!("could not read that snapshot: {e}"))
}

/// The default place for backups: this app's own data folder.
#[tauri::command]
fn default_backup_folder(app: tauri::AppHandle) -> Result<String, String> {
  // On a phone the Documents folder is the one the Files app can show; on the
  // desktop keep backups out of the user's Documents.
  let base = if cfg!(any(target_os = "ios", target_os = "android")) {
    app.path().document_dir()
  } else {
    app.path().app_data_dir()
  };
  let dir = base
    .map_err(|e| format!("no writable folder: {e}"))?
    .join("backups");
  std::fs::create_dir_all(&dir).map_err(|e| format!("could not open {}: {e}", dir.display()))?;
  Ok(dir.display().to_string())
}

#[cfg(target_os = "macos")]
fn reveal(path: &Path) -> std::io::Result<()> {
  std::process::Command::new("open")
    .arg("-R")
    .arg(path)
    .spawn()
    .map(|_| ())
}

#[cfg(target_os = "windows")]
fn reveal(path: &Path) -> std::io::Result<()> {
  std::process::Command::new("explorer")
    .arg(format!("/select,{}", path.display()))
    .spawn()
    .map(|_| ())
}

#[cfg(all(
  unix,
  not(target_os = "macos"),
  not(target_os = "ios"),
  not(target_os = "android")
))]
fn reveal(path: &Path) -> std::io::Result<()> {
  let target = path.parent().unwrap_or(path);
  std::process::Command::new("xdg-open").arg(target).spawn().map(|_| ())
}

#[cfg(any(target_os = "ios", target_os = "android"))]
fn reveal(_path: &Path) -> std::io::Result<()> {
  Err(std::io::Error::new(
    std::io::ErrorKind::Unsupported,
    "the Files app has no reveal command",
  ))
}

/// Show a backup file in the system file manager.
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
  let path = PathBuf::from(path);
  if !path.is_absolute() {
    return Err("only a full path can be revealed".into());
  }
  if !path.exists() {
    return Err("that file is no longer there".into());
  }
  reveal(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn sanitize_keeps_a_plain_name() {
    assert_eq!(sanitize_name("tempo-backup-2026-10-17.json"), "tempo-backup-2026-10-17.json");
  }

  #[test]
  fn sanitize_strips_paths_and_control_characters() {
    assert_eq!(sanitize_name("../../etc/passwd.json"), "passwd.json");
    assert_eq!(sanitize_name("bad:\u{7}name.json"), "badname.json");
  }

  #[test]
  fn sanitize_adds_an_extension_and_never_returns_empty() {
    assert_eq!(sanitize_name("backup"), "backup.json");
    assert_eq!(sanitize_name(""), "tempo-backup.json");
    assert_eq!(sanitize_name(".."), "tempo-backup.json");
  }

  #[test]
  fn write_export_writes_the_file_and_keeps_the_older_one() {
    let dir = std::env::temp_dir().join(format!("tempo-write-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);

    let first = write_export(&dir, "tempo-backup.json", "{\"a\":1}").unwrap();
    let second = write_export(&dir, "tempo-backup.json", "{\"a\":2}").unwrap();

    assert_eq!(std::fs::read_to_string(&first).unwrap(), "{\"a\":1}");
    assert_eq!(std::fs::read_to_string(&second).unwrap(), "{\"a\":2}");
    assert!(second.ends_with("tempo-backup (1).json"));

    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn write_private_keeps_the_file_readable_only_by_the_owner() {
    let dir = std::env::temp_dir().join(format!("tempo-private-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("backup.json");
    std::fs::write(&path, b"old").unwrap();

    write_private(&path, "secret").unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "secret");

    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
      assert_eq!(mode, 0o600);
    }

    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn validate_folder_rejects_relative_and_root_paths() {
    assert!(validate_folder("relative/backups", false).is_err());
    assert!(validate_folder("/", false).is_err());
    assert!(validate_folder("", false).is_err());
  }

  #[test]
  fn auto_backup_rotates_and_replaces() {
    let dir = std::env::temp_dir().join(format!("tempo-auto-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let first = write_auto_backup(dir.display().to_string(), "{\"v\":1}".into()).unwrap();
    assert_eq!(first.bytes, 7);
    assert!(first.path.ends_with(AUTO_BACKUP_NAME));

    write_auto_backup(dir.display().to_string(), "{\"v\":2}".into()).unwrap();

    assert_eq!(std::fs::read_to_string(dir.join(AUTO_BACKUP_NAME)).unwrap(), "{\"v\":2}");
    assert_eq!(
      std::fs::read_to_string(dir.join(AUTO_BACKUP_PREVIOUS)).unwrap(),
      "{\"v\":1}"
    );
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);

    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn history_snapshot_writes_lists_and_reads() {
    let dir = std::env::temp_dir().join(format!("tempo-history-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let contents = r#"{"app":"tempo","version":5,"items":[{"id":"i1","type":"task","title":"Read"}],"projects":[{"id":"p1","name":"School"}],"goals":[],"habits":[],"schedules":[],"workProjects":[]}"#;

    let receipt = write_backup_snapshot(dir.display().to_string(), contents.into()).unwrap();
    assert!(receipt.path.contains("tempo-history"));
    assert_eq!(receipt.bytes, contents.len());

    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mode = std::fs::metadata(&receipt.path).unwrap().permissions().mode() & 0o777;
      assert_eq!(mode, 0o600);
    }

    let list = list_backup_history(dir.display().to_string()).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].items, 1);
    assert_eq!(list[0].calendars, 1);
    assert!(list[0].titles.contains(&"Read".to_string()));
    assert!(list[0].titles.contains(&"School".to_string()));
    assert!(list[0].bytes > 0);

    let text = read_backup_snapshot(dir.display().to_string(), receipt.path).unwrap();
    assert_eq!(text, contents);

    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn history_snapshot_cannot_read_outside_its_folder() {
    let dir = std::env::temp_dir().join(format!("tempo-history-guard-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join(HISTORY_DIR)).unwrap();
    let outside = dir.join("tempo-not-history.json");
    std::fs::write(&outside, b"{}").unwrap();

    let result = read_backup_snapshot(dir.display().to_string(), outside.display().to_string());
    assert!(result.is_err());

    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn prune_history_keeps_the_newest_and_drops_aged_out_files() {
    let dir = std::env::temp_dir().join(format!("tempo-prune-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    for index in 0..4 {
      std::thread::sleep(std::time::Duration::from_millis(6));
      std::fs::write(dir.join(format!("tempo-{index}.json")), b"{}").unwrap();
    }
    prune_history_to(&dir, now_ms(), HISTORY_KEEP_MS, 2, u64::MAX);
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);
    assert!(dir.join("tempo-3.json").exists());
    assert!(dir.join("tempo-2.json").exists());

    // A workspace abandoned for longer than the window empties out entirely.
    let future = now_ms() + HISTORY_KEEP_MS + 60_000;
    prune_history_to(&dir, future, HISTORY_KEEP_MS, 10, u64::MAX);
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);

    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn unique_path_does_not_overwrite() {
    let dir = std::env::temp_dir().join(format!("tempo-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("backup.json"), b"first").unwrap();
    std::fs::write(dir.join("backup (1).json"), b"second").unwrap();

    assert_eq!(unique_path(&dir, "backup.json"), dir.join("backup (2).json"));
    assert_eq!(unique_path(&dir, "other.json"), dir.join("other.json"));

    std::fs::remove_dir_all(&dir).unwrap();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_dialog::init())
    // iOS needs the user-picked, security-scoped sync folder to survive a
    // relaunch. Desktop builds compile the plugin as a stub.
    .plugin(tauri_plugin_scoped_storage::init())
    .manage(SyncFolderState::default())
    .invoke_handler(tauri::generate_handler![
      save_export,
      open_external,
      write_auto_backup,
      write_backup_snapshot,
      list_backup_history,
      read_backup_snapshot,
      default_backup_folder,
      reveal_path,
      sync_status,
      sync_set_folder,
      sync_set_device,
      sync_read_workspace,
      sync_write_workspace,
      sync_list_devices,
      sync_read_meta,
      sync_write_meta,
      sync_list_batches,
      sync_read_batch,
      sync_write_batch,
      sync_delete_batch,
      sync_list_snapshots,
      sync_read_snapshot,
      sync_write_snapshot,
      sync_delete_snapshot
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
