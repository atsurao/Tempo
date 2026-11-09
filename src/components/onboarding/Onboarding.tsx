import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  HardDrive,
  Moon,
  Monitor,
  RotateCcw,
  Sparkles,
  Sun,
  Upload,
  X,
} from "lucide-react";
import { useItems, useProjects, useTags } from "../../db/hooks";
import { useUI } from "../../store/ui";
import { PALETTE } from "../../types";
import type { Project } from "../../types";
import { Switch } from "../ui/Switch";
import { uid } from "../../lib/id";
import {
  applyImportToCalendar,
  planImport,
  type ImportPlan,
} from "../../lib/icsImport";
import {
  defaultBackupFolder,
  isDesktop,
  isIOS,
  listBackupHistory,
  pickBackupFolder,
  readBackupSnapshot,
  type HistoryEntry,
} from "../../lib/desktop";
import {
  readBackupConfig,
  setOnboarded,
  writeBackupConfig,
} from "../../lib/appSettings";
import { flushAutoBackup } from "../../lib/autoBackup";
import { setSetting } from "../../db/db";
import { VERSION_LABEL } from "../../lib/version";
import {
  BackupError,
  backupCounts,
  describeCounts,
  parseBackup,
  restoreBackup,
  type Backup,
  type BackupCounts,
} from "../../lib/backup";
import { historySummary } from "../../lib/backupHistory";
import { clockStamp, clockTime } from "../../lib/clock";

type Step = "look" | "backup" | "data" | "import" | "done";
type DataChoice = "blank" | "import" | "restore";

interface DraftImport {
  id: string;
  fileName: string;
  name: string;
  color: string;
  plan: ImportPlan;
}

interface SnapshotChoice {
  entry: HistoryEntry;
  backup: Backup;
  counts: BackupCounts;
}

const MAX_IMPORT_FILES = 12;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function planSummary(plan: ImportPlan): string {
  const parts: string[] = [];
  if (plan.counts.events) parts.push(plural(plan.counts.events, "event"));
  if (plan.counts.tasks) parts.push(plural(plan.counts.tasks, "task"));
  if (!parts.length) return "Nothing to import";
  if (plan.counts.duplicates) parts.push(`${plural(plan.counts.duplicates, "duplicate")} skipped`);
  return parts.join(" · ");
}

const THEMES = [
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "Match system", Icon: Monitor },
] as const;

/**
 * First-run setup: appearance, where backups go, and whether the workspace
 * starts empty, comes from imported calendars, or is restored from a Tempo
 * backup. It writes its answers to the local database, so it is shown once —
 * and can be replayed from Settings without touching any work (the data step
 * is skipped on a replay).
 */
export function Onboarding({ replay, onClose }: { replay: boolean; onClose: () => void }) {
  const items = useItems();
  const tags = useTags();
  const projects = useProjects();

  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const accent = useUI((s) => s.accent);
  const setAccent = useUI((s) => s.setAccent);
  const timeFormat = useUI((s) => s.timeFormat);
  const setTimeFormat = useUI((s) => s.setTimeFormat);

  const [step, setStep] = useState<Step>("look");
  const [choice, setChoice] = useState<DataChoice | null>(null);
  const [backupOn, setBackupOn] = useState(true);
  const [folder, setFolder] = useState<string | null>(null);
  const [fallbackFolder, setFallbackFolder] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftImport[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [imported, setImported] = useState(0);
  const [restored, setRestored] = useState<BackupCounts | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [backupFile, setBackupFile] = useState<{
    name: string;
    backup: Backup;
    counts: BackupCounts;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotChoice | null>(null);
  const [snapshots, setSnapshots] = useState<HistoryEntry[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const snapshotRequest = useRef(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [saved, fallback] = await Promise.all([
        readBackupConfig(),
        defaultBackupFolder(),
      ]);
      if (!alive) return;
      setBackupOn(saved.enabled);
      setFolder(saved.folder ?? fallback ?? null);
      setFallbackFolder(fallback);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (choice !== "restore") return;
    // A selection from a previous folder must not survive a folder change.
    snapshotRequest.current += 1;
    setSnapshot(null);
    setSnapshotBusy(false);
    setSnapshotError(null);

    if (!isDesktop() || !folder) {
      setSnapshots([]);
      setSnapshotsLoading(false);
      return;
    }

    let alive = true;
    setSnapshotsLoading(true);
    void (async () => {
      try {
        const entries = await listBackupHistory(folder);
        if (!alive) return;
        setSnapshots(entries);
      } catch {
        if (!alive) return;
        setSnapshots([]);
        setSnapshotError("Tempo could not read the snapshot history in this folder.");
      } finally {
        if (alive) setSnapshotsLoading(false);
      }
    })();

    return () => {
      alive = false;
      snapshotRequest.current += 1;
    };
  }, [choice, folder]);

  const steps = useMemo<readonly Step[]>(() => {
    if (replay) return ["look", "backup"];
    return ["look", "backup", "data"];
  }, [replay]);
  // Importing is still part of the "data" step, and the last screen is the end.
  const stepNumber =
    step === "import" ? 3 : step === "done" ? steps.length : steps.indexOf(step) + 1;

  const chooseFolder = async () => {
    setHint(null);
    try {
      const picked = await pickBackupFolder();
      if (picked) {
        setFolder(picked);
        setBackupOn(true);
      } else if (!isDesktop()) {
        setHint("Folder choice is available in the desktop app.");
      }
    } catch {
      setHint("The folder picker could not open.");
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const errors: string[] = [];
    const added: DraftImport[] = [];
    const list = Array.from(files).slice(0, MAX_IMPORT_FILES);
    for (const file of list) {
      if (file.size > MAX_IMPORT_BYTES) {
        errors.push(`${file.name} is larger than 20 MB.`);
        continue;
      }
      try {
        const plan = planImport(await file.text(), items);
        if (!plan.rows.length) {
          errors.push(
            plan.counts.duplicates
              ? `${file.name} is already in Tempo.`
              : `No events or tasks found in ${file.name}.`,
          );
          continue;
        }
        const name =
          plan.calendarName?.trim() ||
          file.name.replace(/\.ics$/i, "").trim() ||
          "Imported calendar";
        added.push({
          id: uid("imp"),
          fileName: file.name,
          name: name.slice(0, 80),
          color: PALETTE[(drafts.length + added.length) % PALETTE.length],
          plan,
        });
      } catch {
        errors.push(`${file.name} could not be read as a calendar.`);
      }
    }
    if (files.length > MAX_IMPORT_FILES) {
      errors.push(`Only the first ${MAX_IMPORT_FILES} files were read.`);
    }
    setDrafts((current) => [...current, ...added]);
    setImportErrors(errors);
  };

  const removeDraft = (id: string) => {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
  };

  const updateDraft = (id: string, patch: Partial<Pick<DraftImport, "name" | "color">>) => {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );
  };

  const openSnapshot = async (entry: HistoryEntry) => {
    if (!folder) return;
    const request = ++snapshotRequest.current;
    setSnapshotError(null);
    setRestoreError(null);
    setSnapshot(null);
    setSnapshotBusy(true);
    setBackupFile(null);
    if (backupRef.current) backupRef.current.value = "";
    try {
      const text = await readBackupSnapshot(folder, entry.path);
      if (request !== snapshotRequest.current) return;
      const backup = parseBackup(text);
      setSnapshot({ entry, backup, counts: backupCounts(backup) });
    } catch (error) {
      if (request !== snapshotRequest.current) return;
      setSnapshotError(
        error instanceof BackupError
          ? error.message
          : "That snapshot could not be read.",
      );
    } finally {
      if (request === snapshotRequest.current) setSnapshotBusy(false);
    }
  };

  const onBackupFile = async (file: File | undefined) => {
    if (!file) return;
    snapshotRequest.current += 1;
    setSnapshot(null);
    setSnapshotBusy(false);
    setSnapshotError(null);
    setRestoreError(null);
    if (file.size > MAX_BACKUP_BYTES) {
      setBackupFile(null);
      setRestoreError("That backup is larger than 100 MB.");
      return;
    }
    try {
      const backup = parseBackup(await file.text());
      setBackupFile({ name: file.name, backup, counts: backupCounts(backup) });
    } catch (error) {
      setBackupFile(null);
      setRestoreError(
        error instanceof BackupError
          ? error.message
          : "That file could not be read as a Tempo backup.",
      );
    }
  };

  const clearBackup = () => {
    snapshotRequest.current += 1;
    setSnapshot(null);
    setSnapshotBusy(false);
    setBackupFile(null);
    setRestoreError(null);
    if (backupRef.current) backupRef.current.value = "";
  };

  const chosen = backupFile ?? snapshot;

  const runRestore = async () => {
    if (!chosen) return;
    setBusy(true);
    setRestoreError(null);
    try {
      const counts = await restoreBackup(chosen.backup, "replace");
      setRestored(counts);
      setStep("done");
    } catch {
      setRestoreError("That backup could not be restored. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!drafts.length) return;
    setBusy(true);
    let count = 0;
    const broken: string[] = [];
    let known: Project[] = [...projects];
    for (const draft of drafts) {
      try {
        const result = await applyImportToCalendar(
          draft.plan,
          tags,
          { name: draft.name, color: draft.color },
          known,
        );
        count += result.events + result.tasks;
        if (result.calendarId) {
          known = [
            ...known,
            { id: result.calendarId, name: draft.name, color: draft.color, order: takenOrder(known) },
          ];
        }
      } catch {
        broken.push(draft.fileName);
      }
    }
    setImported(count);
    setFailed(broken);
    setDrafts([]);
    setBusy(false);
    setStep("done");
  };

  const finish = async () => {
    setFinishing(true);
    try {
      if (!replay) {
        // Whichever way setup went, never drop demo data into this workspace.
        await setSetting("seeded", true);
      }
      await writeBackupConfig({ enabled: backupOn, folder });
      await setOnboarded();
      await flushAutoBackup("manual");
    } catch {
      /* setup is still done even if the first backup could not be written */
    } finally {
      setFinishing(false);
      onClose();
    }
  };

  const advance = () => {
    if (step === "look") setStep("backup");
    else if (step === "backup") setStep(replay ? "done" : "data");
    else if (step === "data") {
      if (choice === "import") setStep("import");
      else if (choice === "restore") void runRestore();
      else setStep("done");
    } else if (step === "import") void runImport();
    else void finish();
  };

  const back = () => {
    if (step === "backup") setStep("look");
    else if (step === "data") setStep("backup");
    else if (step === "import") setStep("data");
  };

  const primaryLabel =
    step === "look"
      ? "Continue"
      : step === "backup"
        ? "Continue"
        : step === "data"
          ? choice === "import"
            ? "Choose files"
            : choice === "restore"
              ? busy
                ? "Restoring…"
                : "Restore backup"
              : "Start blank"
          : step === "import"
            ? busy
              ? "Importing…"
              : `Import ${plural(
                  drafts.reduce((sum, d) => sum + d.plan.counts.events + d.plan.counts.tasks, 0),
                  "item",
                )}`
            : finishing
              ? "Opening…"
              : "Open Tempo";

  const canAdvance =
    !busy &&
    !snapshotBusy &&
    !finishing &&
    (step !== "data" ||
      (choice !== null && (choice !== "restore" || chosen !== null))) &&
    (step !== "import" || drafts.length > 0);

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Set up Tempo">
      <div className="onboarding-card">
        <header className="onboarding-head">
          <span className="onboarding-wordmark">
            <span className="onboarding-dot" />
            {replay ? "Setup" : "Welcome to Tempo"}
          </span>
          <span className="spacer" />
          {!replay && step !== "done" && (
            <span className="onboarding-step">
              Step {stepNumber} of {steps.length}
            </span>
          )}
          {replay && (
            <button className="icon-btn" onClick={onClose} title="Close setup">
              <X size={13} />
            </button>
          )}
        </header>

        <div className="onboarding-body">
          {step === "look" && (
            <>
              <h2 className="onboarding-title">Make it feel like yours</h2>
              <p className="onboarding-sub">
                A minute of setup, then it stays out of the way. Every choice here can be changed
                later in Settings.
              </p>

              <div className="onboarding-themes">
                {THEMES.map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    className="theme-card"
                    data-active={theme === value}
                    onClick={() => setTheme(value)}
                  >
                    <Icon size={15} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              <div className="onboarding-block">
                <div className="onboarding-label">Accent colour</div>
                <div className="onboarding-swatches">
                  {PALETTE.map((color) => (
                    <button
                      key={color}
                      className="swatch"
                      data-active={accent.toLowerCase() === color.toLowerCase()}
                      style={{ background: color }}
                      onClick={() => setAccent(color)}
                      title={color}
                      aria-label={`Accent ${color}`}
                    />
                  ))}
                  <input
                    type="color"
                    value={accent}
                    onChange={(e) => setAccent(e.target.value)}
                    className="onboarding-color"
                    title="Custom accent"
                    aria-label="Custom accent colour"
                  />
                </div>
              </div>

              <div className="onboarding-row">
                <div>
                  <div className="onboarding-label">24-hour time</div>
                  <div className="onboarding-note">
                    Show 14:30 instead of 2:30 PM across the calendar, tasks and clock.
                  </div>
                </div>
                <Switch
                  checked={timeFormat === "24h"}
                  label="Use a 24-hour clock"
                  onChange={(on) => setTimeFormat(on ? "24h" : "12h")}
                />
              </div>
            </>
          )}

          {step === "backup" && (
            <>
              <h2 className="onboarding-title">Keep a copy somewhere safe</h2>
              <p className="onboarding-sub">
                Your work lives in a local database on this device. Tempo writes a backup after you
                stop editing, replacing one file as it goes.
              </p>

              <div className="onboarding-row">
                <div>
                  <div className="onboarding-label">Automatic backups</div>
                  <div className="onboarding-note">
                    About eight seconds after a burst of edits settles.
                  </div>
                </div>
                <Switch
                  checked={backupOn}
                  label="Back up automatically"
                  onChange={setBackupOn}
                />
              </div>

              <div className="backup-path">
                <HardDrive size={15} className="backup-path-icon" />
                <div className="backup-path-body">
                  <span className="onboarding-label">Folder</span>
                  <span className="backup-path-value" title={folder ?? undefined}>
                    {folder ?? "No folder chosen yet"}
                  </span>
                </div>
                {!isIOS() && (
                  <button className="btn sm" onClick={() => void chooseFolder()}>
                    <FolderOpen size={11} /> Choose…
                  </button>
                )}
              </div>

              {!isIOS() && fallbackFolder && folder !== fallbackFolder && (
                <button className="onboarding-link" onClick={() => setFolder(fallbackFolder)}>
                  Use the default folder inside the app's data
                </button>
              )}

              {isIOS() ? (
                <p className="onboarding-note">
                  Backups stay on this iPhone, inside Tempo's Documents folder. Open Files → On
                  My iPhone → Tempo → backups to copy one out. Snapshots are also listed below
                  when you restore.
                </p>
              ) : (
                <p className="onboarding-note">
                  iCloud Drive, Dropbox and OneDrive folders all work — pick their local folder
                  to sync copies off this device. Backup files are readable only by your account.
                </p>
              )}
              {!isDesktop() && (
                <p className="onboarding-note">
                  In the browser build there is no folder picker; automatic backups run in the
                  desktop app.
                </p>
              )}
              {hint && <p className="onboarding-note onboarding-warn">{hint}</p>}
            </>
          )}

          {step === "data" && (
            <>
              <h2 className="onboarding-title">Start blank, or bring your work across?</h2>
              <p className="onboarding-sub">
                Begin empty, import calendars from another app, or restore a Tempo backup.
                Importing later stays available in Settings.
              </p>

              <div className="onboarding-choices">
                <button
                  className="choice-card"
                  data-active={choice === "blank"}
                  onClick={() => setChoice("blank")}
                >
                  <Sparkles size={16} />
                  <span className="choice-title">Start blank</span>
                  <span className="choice-note">
                    An empty workspace, with no sample calendars or tasks.
                  </span>
                </button>
                <button
                  className="choice-card"
                  data-active={choice === "import"}
                  onClick={() => setChoice("import")}
                >
                  <Upload size={16} />
                  <span className="choice-title">Import a calendar</span>
                  <span className="choice-note">
                    Bring .ics files in as calendars you name and colour yourself.
                  </span>
                </button>
                <button
                  className="choice-card choice-card-wide"
                  data-active={choice === "restore"}
                  onClick={() => setChoice("restore")}
                >
                  <RotateCcw size={16} />
                  <span className="choice-copy">
                    <span className="choice-title">Restore a backup</span>
                    <span className="choice-note">
                      Pick an automatic snapshot, or choose a Tempo JSON file from anywhere.
                    </span>
                  </span>
                </button>
              </div>

              {choice === "restore" && (
                <div className="restore-setup">
                  <input
                    ref={backupRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden-file"
                    onChange={(e) => {
                      void onBackupFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />

                  {isDesktop() && (
                    <div className="restore-snapshots">
                      <div className="restore-snapshots-head">
                        <span className="onboarding-label">Automatic snapshots</span>
                        {!isIOS() && (
                          <button
                            className="onboarding-link"
                            onClick={() => void chooseFolder()}
                          >
                            Change folder…
                          </button>
                        )}
                      </div>
                      <span className="restore-folder" title={folder ?? undefined}>
                        {folder ?? "No backup folder chosen yet"}
                      </span>

                      {snapshotsLoading ? (
                        <span className="onboarding-note">Looking for snapshots…</span>
                      ) : !folder ? (
                        <span className="onboarding-note">
                          Choose the folder Tempo backs up to, then its snapshots appear here.
                        </span>
                      ) : snapshots.length === 0 ? (
                        !snapshotError && (
                          <span className="onboarding-note">
                            No snapshots in this folder yet — choose a JSON file below.
                          </span>
                        )
                      ) : (
                        <div className="restore-snapshot-list">
                          {snapshots.map((entry, index) => {
                            const selected = snapshot?.entry.path === entry.path;
                            return (
                              <button
                                key={entry.path}
                                className="restore-snapshot"
                                data-active={selected}
                                aria-pressed={selected}
                                onClick={() => void openSnapshot(entry)}
                                disabled={busy || snapshotBusy}
                              >
                                <span className="restore-snapshot-when">
                                  <span>
                                    {format(entry.writtenAt, "d MMM")}
                                    {index === 0 && <span className="restore-latest">Latest</span>}
                                  </span>
                                  <span className="faint">
                                    {clockTime(entry.writtenAt, timeFormat)}
                                  </span>
                                </span>
                                <span className="restore-snapshot-meta">
                                  <span>{historySummary(entry)}</span>
                                  <span className="restore-snapshot-titles">
                                    {entry.titles.slice(0, 2).join(" · ") || "No names indexed"}
                                  </span>
                                </span>
                                <span className="restore-snapshot-check">
                                  {selected && <Check size={12} />}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {snapshotBusy && (
                        <span className="onboarding-note">Reading snapshot…</span>
                      )}
                      {snapshotError && (
                        <span className="onboarding-note onboarding-warn">{snapshotError}</span>
                      )}
                    </div>
                  )}

                  {snapshot && (
                    <div className="restore-picked">
                      <div className="restore-picked-head">
                        <span
                          className="restore-file"
                          title={clockStamp(snapshot.entry.writtenAt, timeFormat)}
                        >
                          Snapshot from {clockStamp(snapshot.entry.writtenAt, timeFormat)}
                        </span>
                        <button
                          className="icon-btn"
                          title="Remove snapshot"
                          onClick={clearBackup}
                        >
                          <X size={12} />
                        </button>
                      </div>
                      <span className="onboarding-note">
                        {describeCounts(snapshot.counts)}
                      </span>
                    </div>
                  )}

                  {isDesktop() && <div className="restore-divider">or restore a file</div>}

                  {backupFile ? (
                    <>
                      <div className="restore-picked">
                        <div className="restore-picked-head">
                          <span className="restore-file" title={backupFile.name}>
                            {backupFile.name}
                          </span>
                          <button
                            className="icon-btn"
                            title="Remove backup"
                            onClick={clearBackup}
                          >
                            <X size={12} />
                          </button>
                        </div>
                        <span className="onboarding-note">
                          {describeCounts(backupFile.counts)}
                        </span>
                      </div>
                      <button
                        className="onboarding-link"
                        onClick={() => backupRef.current?.click()}
                      >
                        Choose another file
                      </button>
                    </>
                  ) : isDesktop() ? (
                    <button
                      className="onboarding-link"
                      onClick={() => backupRef.current?.click()}
                    >
                      Choose a JSON file instead
                    </button>
                  ) : (
                    <button
                      className="import-drop"
                      onClick={() => backupRef.current?.click()}
                    >
                      <RotateCcw size={16} />
                      <span>Choose a Tempo backup</span>
                      <span className="onboarding-note">
                        The .json file from Settings → Data → Export JSON.
                      </span>
                    </button>
                  )}

                  {restoreError && (
                    <p className="onboarding-note onboarding-warn">{restoreError}</p>
                  )}
                </div>
              )}
            </>
          )}

          {step === "import" && (
            <>
              <h2 className="onboarding-title">Import your calendars</h2>
              <p className="onboarding-sub">
                Choose one or more .ics files. Each becomes a calendar with its own name and
                colour.
              </p>

              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".ics,text/calendar,application/ics"
                className="hidden-file"
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              {drafts.length === 0 ? (
                <button className="import-drop" onClick={() => fileRef.current?.click()}>
                  <Upload size={16} />
                  <span>Choose .ics files</span>
                  <span className="onboarding-note">
                    Google, Apple, Outlook and Fastmail all export this format.
                  </span>
                </button>
              ) : (
                <>
                  <div className="import-list">
                    {drafts.map((draft) => (
                      <div className="import-row" key={draft.id}>
                        <input
                          type="color"
                          value={draft.color}
                          onChange={(e) => updateDraft(draft.id, { color: e.target.value })}
                          className="onboarding-color"
                          title="Calendar colour"
                          aria-label={`Colour for ${draft.name}`}
                        />
                        <input
                          className="input import-name"
                          value={draft.name}
                          onChange={(e) => updateDraft(draft.id, { name: e.target.value })}
                          aria-label={`Name for ${draft.fileName}`}
                          maxLength={80}
                        />
                        <span className="import-count">{planSummary(draft.plan)}</span>
                        <button
                          className="icon-btn"
                          onClick={() => removeDraft(draft.id)}
                          title={`Remove ${draft.fileName}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button className="onboarding-link" onClick={() => fileRef.current?.click()}>
                    Add more files
                  </button>
                </>
              )}

              {importErrors.length > 0 && (
                <ul className="onboarding-errors">
                  {importErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
              <button className="onboarding-link" onClick={() => setStep("done")}>
                Skip importing for now
              </button>
            </>
          )}

          {step === "done" && (
            <div className="onboarding-done">
              <div className="onboarding-badge">
                <Check size={18} />
              </div>
              <h2 className="onboarding-title">You're all set</h2>
              <div className="onboarding-summary">
                <div className="onboarding-summary-row">
                  <span>Appearance</span>
                  <span>
                    {theme === "system" ? "Match system" : theme === "dark" ? "Dark" : "Light"} ·{" "}
                    {accent.toUpperCase()}
                  </span>
                </div>
                <div className="onboarding-summary-row">
                  <span>Backups</span>
                  <span>
                    {backupOn
                      ? folder
                        ? "After each set of edits"
                        : "No folder yet — choose one in Settings"
                      : "Off"}
                  </span>
                </div>
                <div className="onboarding-summary-row">
                  <span>Workspace</span>
                  <span>
                    {restored
                      ? `Restored ${plural(restored.items, "item")}`
                      : imported > 0
                        ? `Imported ${plural(imported, "item")}`
                        : "Blank, ready for you"}
                  </span>
                </div>
              </div>
              {failed.length > 0 && (
                <p className="onboarding-warn">
                  Could not import {failed.join(", ")}. The rest is in place.
                </p>
              )}
              <p className="onboarding-note">
                Tempo {VERSION_LABEL} · everything stays on this device, and nothing needs an
                account.
              </p>
            </div>
          )}
        </div>

        <footer className="onboarding-foot">
          {step !== "look" && step !== "done" ? (
            <button className="btn sm" onClick={back} disabled={busy}>
              <ChevronLeft size={12} /> Back
            </button>
          ) : replay && step === "done" ? (
            <button className="btn sm" onClick={onClose}>
              Close
            </button>
          ) : (
            <span className="onboarding-note">
              {step === "look" ? "Takes about a minute" : ""}
            </span>
          )}
          <span className="spacer" />
          {step === "data" && (
            <span className="onboarding-note onboarding-foot-note">
              You can change this later
            </span>
          )}
          {step !== "done" && (
            <button className="btn sm primary" onClick={advance} disabled={!canAdvance}>
              {primaryLabel}
              {step !== "import" && <ChevronRight size={12} />}
            </button>
          )}
          {step === "done" && (
            <button className="btn sm primary" onClick={() => void finish()} disabled={finishing}>
              {primaryLabel}
              <ChevronRight size={12} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function takenOrder(projects: Project[]): number {
  return projects.reduce((max, project) => Math.max(max, project.order ?? 0), 0) + 1;
}
