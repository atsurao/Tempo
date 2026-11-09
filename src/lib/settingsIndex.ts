/**
 * The settings dialog is built from panes, but search needs a flat list it
 * can rank before anything is rendered. Each entry points at the row that
 * owns the control (`data-setting`), so a result can jump straight to it.
 */
export type SettingsCategoryId =
  | "appearance"
  | "navigation"
  | "calendar"
  | "tasks"
  | "notifications"
  | "sync"
  | "data"
  | "shortcuts";

export interface SettingsCategory {
  id: SettingsCategoryId;
  label: string;
  blurb: string;
}

export interface SettingsEntry {
  /** Matches the `data-setting` attribute on the row in the dialog. */
  id: string;
  category: SettingsCategoryId;
  label: string;
  description: string;
  /** Extra words someone might search for instead of the label. */
  keywords: string;
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: "appearance",
    label: "Appearance",
    blurb: "Theme, colour, density and shape.",
  },
  {
    id: "navigation",
    label: "Navigation",
    blurb: "What sits in the bar or sidebar, and in which order.",
  },
  {
    id: "calendar",
    label: "Calendar",
    blurb: "Time format, the week and the hours on screen.",
  },
  {
    id: "tasks",
    label: "Tasks",
    blurb: "How overdue work follows you around.",
  },
  {
    id: "notifications",
    label: "Notifications",
    blurb: "System alerts for reminders.",
  },
  {
    id: "sync",
    label: "Sync",
    blurb: "Keep devices in step through a shared folder.",
  },
  {
    id: "data",
    label: "Data",
    blurb: "Backups, history and moving your workspace.",
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    blurb: "Every key Tempo listens for.",
  },
];

export const SETTINGS_INDEX: SettingsEntry[] = [
  {
    id: "appearance-dark",
    category: "appearance",
    label: "Dark mode",
    description: "Switch between the light and dark theme.",
    keywords: "theme night light colour color appearance mode",
  },
  {
    id: "appearance-system",
    category: "appearance",
    label: "Follow system",
    description: "Let the operating system choose light or dark.",
    keywords: "automatic theme appearance system light dark",
  },
  {
    id: "appearance-welcome",
    category: "appearance",
    label: "Welcome screen",
    description: "Show the brief launch card when Tempo opens.",
    keywords: "splash launch startup onboarding welcome",
  },
  {
    id: "appearance-accent",
    category: "appearance",
    label: "Accent",
    description: "Pick the colour used for selection and focus.",
    keywords: "colour color tint theme swatch palette",
  },
  {
    id: "appearance-density",
    category: "appearance",
    label: "Density",
    description: "Comfortable or compact spacing.",
    keywords: "spacing layout compact comfortable size",
  },
  {
    id: "appearance-corners",
    category: "appearance",
    label: "Corners",
    description: "Soft, square or round edges.",
    keywords: "radius rounded square shape border",
  },
  {
    id: "navigation-bar",
    category: "navigation",
    label: "Bottom bar",
    description: "Choose which views sit in the phone's bottom bar, and their order.",
    keywords: "navigation nav tabs bottom bar phone mobile order reorder customize hide show",
  },
  {
    id: "navigation-sidebar",
    category: "navigation",
    label: "Sidebar views",
    description: "Choose which views sit in the desktop sidebar, and their order.",
    keywords: "navigation nav sidebar rail desktop views order reorder customize hide show",
  },
  {
    id: "navigation-reset",
    category: "navigation",
    label: "Reset navigation",
    description: "Return the bottom bar and sidebar to their default views.",
    keywords: "reset default navigation tabs sidebar order restore layout",
  },
  {
    id: "calendar-time",
    category: "calendar",
    label: "24-hour time",
    description: "Show 14:30 instead of 2:30 PM.",
    keywords: "clock format am pm hour",
  },
  {
    id: "calendar-week",
    category: "calendar",
    label: "Week starts Sunday",
    description: "Set the first column of the week and month grids.",
    keywords: "week start monday sunday first day grid",
  },
  {
    id: "calendar-hours",
    category: "calendar",
    label: "Visible hours",
    description: "Trim the hours shown in the day and week views.",
    keywords: "day start end range hours grid scroll",
  },
  {
    id: "tasks-overdue",
    category: "tasks",
    label: "Persistent overdue",
    description: "Keep overdue tasks visible even when their calendar is hidden.",
    keywords: "overdue late tasks hidden calendars",
  },
  {
    id: "notifications-alerts",
    category: "notifications",
    label: "System alerts",
    description: "Allow operating-system notifications for reminders.",
    keywords: "notifications reminders alerts permission system",
  },
  {
    id: "sync-enable",
    category: "sync",
    label: "Folder sync",
    description: "Keep this Mac and your other devices in step through a shared folder.",
    keywords: "sync folder icloud dropbox drive syncthing devices mac iphone mirror",
  },
  {
    id: "sync-status",
    category: "sync",
    label: "Sync status",
    description: "See the chosen folder, pending batches and devices seen.",
    keywords: "pending queue status devices folder path shared",
  },
  {
    id: "sync-conflicts",
    category: "sync",
    label: "Sync conflicts",
    description: "Review changes that arrived while this Mac had a newer edit.",
    keywords: "conflict merge overwrite lost resolution",
  },
  {
    id: "data-backups",
    category: "data",
    label: "Automatic backups",
    description: "Save the workspace after edits settle.",
    keywords: "backup folder automatic save autosave snapshots",
  },
  {
    id: "data-history",
    category: "data",
    label: "Backup history",
    description: "Browse and restore hourly snapshots from the last two weeks.",
    keywords: "history snapshots restore undo backup two weeks",
  },
  {
    id: "data-export",
    category: "data",
    label: "Export & import",
    description: "Move the whole workspace as a JSON file.",
    keywords: "export import json file move device restore backup",
  },
  {
    id: "data-ics",
    category: "data",
    label: "Calendar import",
    description: "Bring in events and tasks from an .ics file.",
    keywords: "ics ical import calendar google apple outlook fastmail",
  },
  {
    id: "data-setup",
    category: "data",
    label: "Run setup again",
    description: "Reopen the welcome flow for appearance and backups.",
    keywords: "setup wizard onboarding welcome appearance backups",
  },
  {
    id: "data-reset",
    category: "data",
    label: "Reset all data",
    description: "Delete everything on this device and start fresh.",
    keywords: "reset erase delete wipe clear factory fresh start over all data database",
  },
  {
    id: "data-privacy",
    category: "data",
    label: "Local storage",
    description: "Nothing leaves this device unless you enable sync or back it up elsewhere.",
    keywords: "privacy local database telemetry account cloud storage",
  },
  {
    id: "shortcuts-list",
    category: "shortcuts",
    label: "Keyboard shortcuts",
    description: "See every key Tempo listens for.",
    keywords: "keys hotkeys commands keyboard",
  },
];

const categoryOrder = new Map(
  SETTINGS_CATEGORIES.map((category, index) => [category.id, index]),
);

export function settingsCategory(id: SettingsCategoryId): SettingsCategory {
  return SETTINGS_CATEGORIES.find((category) => category.id === id) ?? SETTINGS_CATEGORIES[0];
}

function haystack(entry: SettingsEntry): string {
  return `${entry.label} ${entry.description} ${entry.keywords} ${settingsCategory(entry.category).label}`.toLowerCase();
}

/** Higher is a better match; -1 means the entry does not match at all. */
function matchScore(query: string, tokens: string[], entry: SettingsEntry): number {
  const label = entry.label.toLowerCase();
  if (label === query) return 300;
  if (label.startsWith(query)) return 260 - Math.min(40, label.length - query.length);
  const at = label.indexOf(query);
  if (at >= 0) return 240 - Math.min(80, at);
  if (tokens.every((token) => label.includes(token))) return 200;
  const hay = haystack(entry);
  if (tokens.every((token) => hay.includes(token))) return 100;
  return -1;
}

/**
 * Search setting labels first, then descriptions and keywords. Every word in
 * the query has to appear somewhere, so "backup folder" narrows rather than
 * widens. An empty query has no results; the dialog shows the active pane.
 */
export function searchSettings(
  query: string,
  entries: SettingsEntry[] = SETTINGS_INDEX,
): SettingsEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/).filter(Boolean);

  return entries
    .map((entry) => ({ entry, score: matchScore(normalized, tokens, entry) }))
    .filter((result) => result.score >= 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (categoryOrder.get(a.entry.category) ?? 0) - (categoryOrder.get(b.entry.category) ?? 0) ||
        a.entry.label.localeCompare(b.entry.label),
    )
    .map((result) => result.entry);
}

/** Results grouped in sidebar order, with empty categories left out. */
export function groupSettings(
  entries: SettingsEntry[],
): { category: SettingsCategory; entries: SettingsEntry[] }[] {
  return SETTINGS_CATEGORIES.map((category) => ({
    category,
    entries: entries.filter((entry) => entry.category === category.id),
  })).filter((group) => group.entries.length > 0);
}
