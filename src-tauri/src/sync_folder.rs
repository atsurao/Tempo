use serde::Serialize;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_SYNC_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DEVICE_ID_BYTES: usize = 128;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(1);

/// The folder chosen by the user plus the local device identity. The native
/// layer never learns about iCloud, Dropbox or any other file-sharing service:
/// it only reads and writes the folder those services already sync.
#[derive(Default)]
pub struct SyncFolderState {
  root: Mutex<Option<PathBuf>>,
  local: Mutex<Option<String>>,
}

impl SyncFolderState {
  fn set_root(&self, path: &str) -> Result<PathBuf, String> {
    let root = validate_root(path)?;
    let mut current = self
      .root
      .lock()
      .map_err(|_| "the sync folder state is unavailable".to_string())?;
    *current = Some(root.clone());
    Ok(root)
  }

  fn root(&self) -> Result<PathBuf, String> {
    let current = self
      .root
      .lock()
      .map_err(|_| "the sync folder state is unavailable".to_string())?;
    current
      .clone()
      .ok_or_else(|| "Choose a folder for sync first.".to_string())
  }

  fn set(&self, device_id: &str) -> Result<(), String> {
    ensure_device_id(device_id)?;
    let mut local = self
      .local
      .lock()
      .map_err(|_| "the sync device state is unavailable".to_string())?;
    *local = Some(device_id.to_string());
    Ok(())
  }

  fn require(&self, device_id: &str) -> Result<(), String> {
    ensure_device_id(device_id)?;
    let local = self
      .local
      .lock()
      .map_err(|_| "the sync device state is unavailable".to_string())?;
    match local.as_deref() {
      Some(value) if value == device_id => Ok(()),
      Some(_) => Err("this device cannot write into another device's sync folder".into()),
      None => Err("sync is not enabled for this device".into()),
    }
  }

  fn require_configured(&self) -> Result<(), String> {
    let local = self
      .local
      .lock()
      .map_err(|_| "the sync device state is unavailable".to_string())?;
    if local.is_some() {
      Ok(())
    } else {
      Err("sync is not enabled for this device".into())
    }
  }
}

/// A picked folder must already exist. Resolving it to a canonical path keeps
/// later journal paths anchored to one directory and rejects the disk root,
/// where `workspace.json` and `devices/` must never be written.
fn validate_root(path: &str) -> Result<PathBuf, String> {
  let trimmed = path.trim();
  if trimmed.is_empty() {
    return Err("Choose a folder for sync first.".into());
  }
  let candidate = Path::new(trimmed);
  if !candidate.is_absolute() {
    return Err("Choose an absolute folder for sync.".into());
  }
  validate_root_path(candidate)
}

fn validate_root_path(candidate: &Path) -> Result<PathBuf, String> {
  let root = std::fs::canonicalize(candidate).map_err(|_| {
    "That sync folder is unavailable. Choose it again or check the file-sharing app.".to_string()
  })?;
  let meta = std::fs::metadata(&root).map_err(|_| {
    "That sync folder is unavailable. Choose it again or check the file-sharing app.".to_string()
  })?;
  if !meta.is_dir() {
    return Err("The sync folder is not a folder.".into());
  }
  if root.parent().is_none() {
    return Err("Choose a folder other than the disk root.".into());
  }
  Ok(root)
}

fn is_valid_device_id(value: &str) -> bool {
  let mut chars = value.chars();
  let Some(first) = chars.next() else {
    return false;
  };
  value.len() <= MAX_DEVICE_ID_BYTES
    && first.is_ascii_alphanumeric()
    && chars.all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

fn ensure_device_id(value: &str) -> Result<(), String> {
  if is_valid_device_id(value) {
    Ok(())
  } else {
    Err("invalid sync device id".into())
  }
}

fn ensure_seq(seq: u64, min: u64) -> Result<(), String> {
  if seq < min {
    Err("invalid sync sequence".into())
  } else {
    Ok(())
  }
}

fn file_name(seq: u64) -> String {
  format!("{seq:08}.json")
}

fn parse_seq(name: &str) -> Option<u64> {
  let stem = name.strip_suffix(".json")?;
  if stem.is_empty() || !stem.bytes().all(|byte| byte.is_ascii_digit()) {
    return None;
  }
  stem.parse().ok()
}

fn now_temp_id() -> u64 {
  TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
}

fn create_private_dir(dir: &Path) -> Result<(), String> {
  std::fs::create_dir_all(dir)
    .map_err(|error| format!("could not open {}: {error}", dir.display()))?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    // Google Drive, SMB shares and some other provider folders do not support
    // POSIX modes. Keep the journal private where the filesystem allows it,
    // but do not make sync unusable when chmod is refused.
    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
  }
  Ok(())
}

fn write_private(path: &Path, text: &str) -> Result<(), String> {
  let mut options = std::fs::OpenOptions::new();
  options.write(true).create(true).truncate(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  let mut file = options
    .open(path)
    .map_err(|error| format!("could not write {}: {error}", path.display()))?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let _ = file.set_permissions(std::fs::Permissions::from_mode(0o600));
  }
  file
    .write_all(text.as_bytes())
    .and_then(|_| file.sync_all())
    .map_err(|error| format!("could not write {}: {error}", path.display()))
}

/// The native half of `SyncFolder`. Paths are always assembled here from a
/// validated device id and sequence; JavaScript only supplies the chosen root.
struct SyncStore {
  root: PathBuf,
}

impl SyncStore {
  fn new(root: PathBuf) -> Self {
    Self { root }
  }

  fn ensure_root(&self) -> Result<(), String> {
    create_private_dir(&self.root)
  }

  fn workspace_path(&self) -> PathBuf {
    self.root.join("workspace.json")
  }

  fn device_dir(&self, device_id: &str) -> Result<PathBuf, String> {
    ensure_device_id(device_id)?;
    Ok(self.root.join("devices").join(device_id))
  }

  fn meta_path(&self, device_id: &str) -> Result<PathBuf, String> {
    Ok(self.device_dir(device_id)?.join("meta.json"))
  }

  fn ops_dir(&self, device_id: &str) -> Result<PathBuf, String> {
    Ok(self.device_dir(device_id)?.join("ops"))
  }

  fn snapshots_dir(&self, device_id: &str) -> Result<PathBuf, String> {
    Ok(self.device_dir(device_id)?.join("snapshots"))
  }

  fn batch_path(&self, device_id: &str, seq: u64) -> Result<PathBuf, String> {
    ensure_seq(seq, 1)?;
    Ok(self.ops_dir(device_id)?.join(file_name(seq)))
  }

  fn snapshot_path(&self, device_id: &str, seq: u64) -> Result<PathBuf, String> {
    Ok(self.snapshots_dir(device_id)?.join(file_name(seq)))
  }

  fn read_workspace(&self) -> Result<Option<String>, String> {
    self.read_text(&self.workspace_path())
  }

  fn write_workspace(&self, text: &str, replace: bool) -> Result<(), String> {
    self.ensure_root()?;
    let path = self.workspace_path();
    if replace {
      self.archive_devices()?;
      self.write_replace(&path, text)
    } else {
      self.write_create(&path, text)
    }
  }

  /// A confirmed Start-new replaces workspace.json. Move the old device
  /// folders aside first so their old-workspace files cannot be mistaken for
  /// this workspace's history. The archive stays inside the chosen folder.
  fn archive_devices(&self) -> Result<(), String> {
    let devices = self.root.join("devices");
    let meta = match std::fs::symlink_metadata(&devices) {
      Ok(meta) => meta,
      Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
      Err(error) => {
        return Err(format!("could not open {}: {error}", devices.display()))
      }
    };
    if meta.file_type().is_symlink() {
      return Err("the sync devices folder is not a directory".into());
    }
    if !meta.is_dir() {
      return Ok(());
    }

    let archive = self.root.join("archive");
    create_private_dir(&archive)?;
    let stamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|duration| duration.as_millis())
      .unwrap_or(0);
    let target = archive.join(format!("devices-{stamp}-{}", now_temp_id()));
    std::fs::rename(&devices, &target)
      .map_err(|error| format!("could not archive {}: {error}", devices.display()))
  }

  fn list_devices(&self) -> Result<Vec<String>, String> {
    let dir = self.root.join("devices");
    let mut devices = Vec::new();
    for entry in read_dir_optional(&dir)? {
      let entry = entry.map_err(|error| format!("could not read {}: {error}", dir.display()))?;
      let Ok(file_type) = entry.file_type() else {
        continue;
      };
      let name = entry.file_name();
      let Some(name) = name.to_str() else {
        continue;
      };
      if file_type.is_dir() && is_valid_device_id(name) {
        devices.push(name.to_string());
      }
    }
    devices.sort();
    Ok(devices)
  }

  fn read_meta(&self, device_id: &str) -> Result<Option<String>, String> {
    self.read_text(&self.meta_path(device_id)?)
  }

  fn write_meta(&self, device_id: &str, text: &str) -> Result<(), String> {
    self.ensure_device_dir(device_id)?;
    self.write_replace(&self.meta_path(device_id)?, text)
  }

  fn list_batches(&self, device_id: &str) -> Result<Vec<u64>, String> {
    list_seqs(&self.ops_dir(device_id)?, 1)
  }

  fn read_batch(&self, device_id: &str, seq: u64) -> Result<Option<String>, String> {
    self.read_text(&self.batch_path(device_id, seq)?)
  }

  fn write_batch(&self, device_id: &str, seq: u64, text: &str) -> Result<(), String> {
    self.ensure_device_dir(device_id)?;
    self.write_create(&self.batch_path(device_id, seq)?, text)
  }

  fn delete_batch(&self, device_id: &str, seq: u64) -> Result<(), String> {
    delete_optional(&self.batch_path(device_id, seq)?)
  }

  fn list_snapshots(&self, device_id: &str) -> Result<Vec<u64>, String> {
    list_seqs(&self.snapshots_dir(device_id)?, 0)
  }

  fn read_snapshot(&self, device_id: &str, seq: u64) -> Result<Option<String>, String> {
    self.read_text(&self.snapshot_path(device_id, seq)?)
  }

  fn write_snapshot(&self, device_id: &str, seq: u64, text: &str) -> Result<(), String> {
    self.ensure_device_dir(device_id)?;
    self.write_create(&self.snapshot_path(device_id, seq)?, text)
  }

  fn delete_snapshot(&self, device_id: &str, seq: u64) -> Result<(), String> {
    delete_optional(&self.snapshot_path(device_id, seq)?)
  }

  fn ensure_device_dir(&self, device_id: &str) -> Result<(), String> {
    self.ensure_root()?;
    create_private_dir(&self.device_dir(device_id)?)
  }

  fn read_text(&self, path: &Path) -> Result<Option<String>, String> {
    let meta = match std::fs::symlink_metadata(path) {
      Ok(meta) => meta,
      Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
      Err(error) => return Err(format!("could not open {}: {error}", path.display())),
    };
    if meta.file_type().is_symlink() {
      return Err("that sync path is not a regular file".into());
    }
    if !meta.is_file() {
      return Ok(None);
    }
    if meta.len() > MAX_SYNC_FILE_BYTES {
      return Err("that sync file is larger than this version supports".into());
    }
    std::fs::read_to_string(path)
      .map(Some)
      .map_err(|error| format!("could not read {}: {error}", path.display()))
  }

  /// Create-if-absent, with identical bytes treated as a successful retry.
  fn write_create(&self, target: &Path, text: &str) -> Result<(), String> {
    if text.len() as u64 > MAX_SYNC_FILE_BYTES {
      return Err("that sync file is larger than this version supports".into());
    }
    self.ensure_root()?;
    if let Some(parent) = target.parent() {
      create_private_dir(parent)?;
    }
    let temp = self.write_temp(text)?;
    let result = match std::fs::hard_link(&temp, target) {
      Ok(()) => Ok(()),
      Err(error) if error.kind() == ErrorKind::AlreadyExists => {
        self.assert_same_text(target, text)
      }
      Err(_) => self.create_new(target, text),
    };
    let _ = std::fs::remove_file(&temp);
    result
  }

  fn write_replace(&self, target: &Path, text: &str) -> Result<(), String> {
    if text.len() as u64 > MAX_SYNC_FILE_BYTES {
      return Err("that sync file is larger than this version supports".into());
    }
    self.ensure_root()?;
    if let Some(parent) = target.parent() {
      create_private_dir(parent)?;
    }
    let temp = self.write_temp(text)?;
    let result = replace_file(&temp, target);
    let _ = std::fs::remove_file(&temp);
    result
  }

  fn write_temp(&self, text: &str) -> Result<PathBuf, String> {
    let parent = self.root.parent().unwrap_or(&self.root);
    std::fs::create_dir_all(parent)
      .map_err(|error| format!("could not open {}: {error}", parent.display()))?;
    let path = parent.join(format!(
      ".tempo-sync-{}-{}.tmp",
      std::process::id(),
      now_temp_id()
    ));
    write_private(&path, text)?;
    Ok(path)
  }

  fn create_new(&self, target: &Path, text: &str) -> Result<(), String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
      use std::os::unix::fs::OpenOptionsExt;
      options.mode(0o600);
    }
    let mut file = match options.open(target) {
      Ok(file) => file,
      Err(error) if error.kind() == ErrorKind::AlreadyExists => {
        return self.assert_same_text(target, text);
      }
      Err(error) => {
        return Err(format!("could not write {}: {error}", target.display()));
      }
    };
    if let Err(error) = file
      .write_all(text.as_bytes())
      .and_then(|_| file.sync_all())
    {
      let _ = std::fs::remove_file(target);
      return Err(format!("could not write {}: {error}", target.display()));
    }
    Ok(())
  }

  fn assert_same_text(&self, target: &Path, text: &str) -> Result<(), String> {
    let existing = self.read_text(target)?;
    if existing.as_deref() == Some(text) {
      Ok(())
    } else {
      Err("that sync file already exists with different content".into())
    }
  }
}

fn read_dir_optional(
  dir: &Path,
) -> Result<Box<dyn Iterator<Item = std::io::Result<std::fs::DirEntry>>>, String> {
  let entries = match std::fs::read_dir(dir) {
    Ok(entries) => entries,
    Err(error) if error.kind() == ErrorKind::NotFound => {
      return Ok(Box::new(std::iter::empty()));
    }
    Err(error) => {
      return Err(format!("could not open {}: {error}", dir.display()));
    }
  };
  Ok(Box::new(entries))
}

fn list_seqs(dir: &Path, min: u64) -> Result<Vec<u64>, String> {
  let mut seqs = Vec::new();
  for entry in read_dir_optional(dir)? {
    let entry = entry.map_err(|error| format!("could not read {}: {error}", dir.display()))?;
    let Ok(file_type) = entry.file_type() else {
      continue;
    };
    if !file_type.is_file() {
      continue;
    }
    let name = entry.file_name();
    let Some(name) = name.to_str() else {
      continue;
    };
    if let Some(seq) = parse_seq(name) {
      if seq >= min {
        seqs.push(seq);
      }
    }
  }
  seqs.sort_unstable();
  Ok(seqs)
}

fn delete_optional(path: &Path) -> Result<(), String> {
  match std::fs::remove_file(path) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
    Err(error) => Err(format!("could not delete {}: {error}", path.display())),
  }
}

fn replace_file(temp: &Path, target: &Path) -> Result<(), String> {
  match std::fs::rename(temp, target) {
    Ok(()) => Ok(()),
    Err(_) => {
      // Windows cannot replace an existing file with rename. Meta is advisory
      // and workspace.json replace is an explicit reset, so a brief gap here is
      // acceptable. Batch and snapshot writes never use this path.
      let _ = std::fs::remove_file(target);
      std::fs::rename(temp, target)
        .map_err(|error| format!("could not replace {}: {error}", target.display()))
    }
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFolderStatus {
  available: bool,
  root: Option<String>,
  reason: Option<String>,
}

fn folder_status(root: Result<PathBuf, String>) -> SyncFolderStatus {
  match root {
    Ok(root) => SyncFolderStatus {
      available: true,
      root: Some(root.display().to_string()),
      reason: None,
    },
    Err(reason) => SyncFolderStatus {
      available: false,
      root: None,
      reason: Some(reason),
    },
  }
}

fn store(state: &SyncFolderState) -> Result<SyncStore, String> {
  Ok(SyncStore::new(validate_root_path(&state.root()?)?))
}

#[tauri::command]
pub fn sync_status(state: tauri::State<'_, SyncFolderState>) -> SyncFolderStatus {
  folder_status(state.root().and_then(|path| validate_root_path(&path)))
}

#[tauri::command]
pub fn sync_set_folder(
  state: tauri::State<'_, SyncFolderState>,
  path: String,
) -> Result<SyncFolderStatus, String> {
  state.set_root(&path)?;
  Ok(folder_status(state.root()))
}

#[tauri::command]
pub fn sync_set_device(
  state: tauri::State<'_, SyncFolderState>,
  device_id: String,
) -> Result<(), String> {
  state.set(&device_id)
}

#[tauri::command]
pub fn sync_read_workspace(
  state: tauri::State<'_, SyncFolderState>,
) -> Result<Option<String>, String> {
  store(state.inner())?.read_workspace()
}

#[tauri::command]
pub fn sync_write_workspace(
  state: tauri::State<'_, SyncFolderState>,
  text: String,
  replace: Option<bool>,
) -> Result<(), String> {
  state.require_configured()?;
  store(state.inner())?.write_workspace(&text, replace.unwrap_or(false))
}

#[tauri::command]
pub fn sync_list_devices(state: tauri::State<'_, SyncFolderState>) -> Result<Vec<String>, String> {
  store(state.inner())?.list_devices()
}

#[tauri::command]
pub fn sync_read_meta(
  state: tauri::State<'_, SyncFolderState>,
  device_id: String,
) -> Result<Option<String>, String> {
  store(state.inner())?.read_meta(&device_id)
}

#[tauri::command]
pub fn sync_write_meta(
  state: tauri::State<'_, SyncFolderState>,
  device_id: String,
  text: String,
) -> Result<(), String> {
  state.require(&device_id)?;
  store(state.inner())?.write_meta(&device_id, &text)
}

#[tauri::command]
pub fn sync_list_batches(
  state: tauri::State<'_, SyncFolderState>,
  device_id: String,
) -> Result<Vec<u64>, String> {
  store(state.inner())?.list_batches(&device_id)
}

#[tauri::command]
pub fn sync_read_batch(
  state: tauri::State<'_, SyncFolderState>,
  device_id: String,
  seq: u64,
) -> Result<Option<String>, String> {
  store(state.inner())?.read_batch(&device_id, seq)
}

#[tauri::command]
pub fn sync_write_batch(
  state: tauri::State<'_, SyncFolderState>,
  device_id: String,
  seq: u64,
  text: String,
) -> Result<(), String> {
  state.require(&device_id)?;
  store(state.inner())?.write_batch(&device_id, seq, &text)
}

#[tauri::command]
pub fn sync_delete_batch(
  state: tauri::State<'_, SyncFolderState>,
  device_id: String,
  seq: u64,
) -> Result<(), String> {
  state.require(&device_id)?;
  store(state.inner())?.delete_batch(&device_id, seq)
}

#[tauri::command]
pub fn sync_list_snapshots(
  state: tauri::State<'_, SyncFolderState>,
  device_id: String,
) -> Result<Vec<u64>, String> {
  store(state.inner())?.list_snapshots(&device_id)
}

#[tauri::command]
pub fn sync_read_snapshot(
  state: tauri::State<'_, SyncFolderState>,
  device_id: String,
  seq: u64,
) -> Result<Option<String>, String> {
  store(state.inner())?.read_snapshot(&device_id, seq)
}

#[tauri::command]
pub fn sync_write_snapshot(
  state: tauri::State<'_, SyncFolderState>,
  device_id: String,
  seq: u64,
  text: String,
) -> Result<(), String> {
  state.require(&device_id)?;
  store(state.inner())?.write_snapshot(&device_id, seq, &text)
}

#[tauri::command]
pub fn sync_delete_snapshot(
  state: tauri::State<'_, SyncFolderState>,
  device_id: String,
  seq: u64,
) -> Result<(), String> {
  state.require(&device_id)?;
  store(state.inner())?.delete_snapshot(&device_id, seq)
}

#[cfg(test)]
mod tests {
  use super::*;

  static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

  fn temp_root(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
      "tempo-sync-folder-{label}-{}-{}",
      std::process::id(),
      TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
  }

  #[test]
  fn workspace_is_create_if_absent_and_replace_only_on_request() {
    let root = temp_root("workspace");
    let store = SyncStore::new(root.clone());

    assert_eq!(store.read_workspace().unwrap(), None);
    store.write_workspace("one", false).unwrap();
    assert_eq!(store.read_workspace().unwrap().as_deref(), Some("one"));
    assert!(store.write_workspace("two", false).is_err());
    assert_eq!(store.read_workspace().unwrap().as_deref(), Some("one"));

    store.write_workspace("two", true).unwrap();
    assert_eq!(store.read_workspace().unwrap().as_deref(), Some("two"));

    std::fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn replacing_a_workspace_archives_the_old_device_folders() {
    let root = temp_root("archive");
    let store = SyncStore::new(root.clone());

    store.write_workspace("one", false).unwrap();
    store.write_batch("mac", 1, "one").unwrap();
    store.write_snapshot("mac", 0, "zero").unwrap();
    store.write_workspace("two", true).unwrap();

    assert_eq!(store.read_workspace().unwrap().as_deref(), Some("two"));
    assert!(store.list_devices().unwrap().is_empty());
    assert_eq!(std::fs::read_dir(root.join("archive")).unwrap().count(), 1);

    std::fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn batches_are_atomic_idempotent_and_listed_numerically() {
    let root = temp_root("batches");
    let store = SyncStore::new(root.clone());

    store.write_batch("mac", 2, "two").unwrap();
    store.write_batch("mac", 2, "two").unwrap();
    store.write_batch("mac", 1, "one").unwrap();
    store.write_batch("mac", 10, "ten").unwrap();

    assert_eq!(store.list_batches("mac").unwrap(), vec![1, 2, 10]);
    assert_eq!(store.read_batch("mac", 2).unwrap().as_deref(), Some("two"));
    assert!(store.write_batch("mac", 2, "changed").is_err());
    assert_eq!(store.read_batch("mac", 2).unwrap().as_deref(), Some("two"));

    store.delete_batch("mac", 2).unwrap();
    assert_eq!(store.list_batches("mac").unwrap(), vec![1, 10]);
    assert_eq!(store.read_batch("mac", 2).unwrap(), None);

    std::fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn snapshots_include_sequence_zero_and_meta_is_replaced() {
    let root = temp_root("snapshots");
    let store = SyncStore::new(root.clone());

    store.write_snapshot("mac", 0, "zero").unwrap();
    store.write_snapshot("mac", 5, "five").unwrap();
    assert_eq!(store.list_snapshots("mac").unwrap(), vec![0, 5]);
    assert_eq!(store.read_snapshot("mac", 0).unwrap().as_deref(), Some("zero"));

    store.write_meta("mac", "first").unwrap();
    store.write_meta("mac", "second").unwrap();
    assert_eq!(store.read_meta("mac").unwrap().as_deref(), Some("second"));

    std::fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn listings_ignore_provider_conflicts_and_non_json_files() {
    let root = temp_root("listing");
    let store = SyncStore::new(root.clone());
    store.write_batch("mac", 3, "three").unwrap();
    let ops = store.ops_dir("mac").unwrap();
    std::fs::write(ops.join("00000002.json"), "two").unwrap();
    std::fs::write(ops.join("00000004.json (1)"), "conflict").unwrap();
    std::fs::write(ops.join("notes.txt"), "ignored").unwrap();

    assert_eq!(store.list_batches("mac").unwrap(), vec![2, 3]);

    std::fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn device_ids_and_sequences_cannot_escape_the_folder() {
    assert!(is_valid_device_id("mac"));
    assert!(is_valid_device_id("phone-2.local"));
    assert!(!is_valid_device_id("../escape"));
    assert!(!is_valid_device_id(""));
    assert!(!is_valid_device_id(".hidden"));
    assert!(!is_valid_device_id("has space"));

    let store = SyncStore::new(temp_root("guard"));
    assert!(store.read_batch("../escape", 1).is_err());
    assert!(store.write_batch("mac", 0, "zero").is_err());
    assert!(store.read_snapshot("mac", 0).is_ok());
  }

  #[test]
  fn native_state_only_allows_the_local_device_to_mutate() {
    let state = SyncFolderState::default();
    assert!(state.require("mac").is_err());
    assert!(state.require_configured().is_err());
    assert!(state.root().is_err());

    state.set("mac").unwrap();
    assert!(state.require_configured().is_ok());
    assert!(state.require("mac").is_ok());
    assert!(state.require("phone").is_err());
    assert!(state.set("../escape").is_err());
  }

  #[test]
  fn chosen_folder_is_resolved_and_validated() {
    let state = SyncFolderState::default();
    assert!(state.set_root("").is_err());
    assert!(state.set_root("relative/folder").is_err());
    assert!(state.set_root("/this/folder/does/not/exist").is_err());
    assert!(state.set_root("/").is_err());

    let root = temp_root("chosen");
    state.set_root(root.to_str().unwrap()).unwrap();
    assert_eq!(state.root().unwrap(), std::fs::canonicalize(&root).unwrap());

    std::fs::remove_dir_all(&root).unwrap();
    assert!(store(&state).is_err());
  }

  #[test]
  fn sync_files_are_owner_only() {
    let root = temp_root("private");
    let store = SyncStore::new(root.clone());
    store.write_batch("mac", 1, "secret").unwrap();

    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let path = store.batch_path("mac", 1).unwrap();
      let mode = std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
      assert_eq!(mode, 0o600);
    }

    std::fs::remove_dir_all(root).unwrap();
  }
}
