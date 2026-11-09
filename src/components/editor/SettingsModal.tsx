import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Cloud,
  Database,
  Keyboard,
  ListTodo,
  Moon,
  Palette,
  PanelBottom,
  RotateCcw,
  Search,
  Sun,
  X,
} from "lucide-react";
import { useUI, type PaneKind } from "../../store/ui";
import { MOBILE_BAR_LIMIT } from "../../lib/navPrefs";
import { navView } from "../shell/navViews";
import { Switch } from "../ui/Switch";
import { readShowSplash, setShowSplash } from "../../lib/appSettings";
import { VERSION_LABEL } from "../../lib/version";
import { BackupSettings } from "./BackupSettings";
import { PALETTE } from "../../types";
import { IcsImport } from "./IcsImport";
import { BackupRestore } from "./BackupRestore";
import { ResetData } from "./ResetData";
import { SyncSettings } from "./SyncSettings";
import {
  checkNotificationPermission,
  requestNotificationPermission,
  type PermissionState,
} from "../../lib/notify";
import { Select } from "../ui/Select";
import { TabStrip } from "../ui/TabStrip";
import { useIsMobile } from "../../hooks/useIsMobile";
import { clockHour } from "../../lib/clock";
import {
  SETTINGS_CATEGORIES,
  groupSettings,
  searchSettings,
  settingsCategory,
  type SettingsCategoryId,
  type SettingsEntry,
} from "../../lib/settingsIndex";

/** Hour choices in the reader's own clock, so 12h Settings read 9 AM, not 09:00. */
const hourOptions = (format: "12h" | "24h") =>
  Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: clockHour(h, format) }));

function categoryIcon(id: SettingsCategoryId) {
  switch (id) {
    case "appearance":
      return <Palette size={13} />;
    case "navigation":
      return <PanelBottom size={13} />;
    case "calendar":
      return <CalendarDays size={13} />;
    case "tasks":
      return <ListTodo size={13} />;
    case "notifications":
      return <Bell size={13} />;
    case "sync":
      return <Cloud size={13} />;
    case "data":
      return <Database size={13} />;
    case "shortcuts":
      return <Keyboard size={13} />;
  }
}

function AppearancePane() {
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const accent = useUI((s) => s.accent);
  const setAccent = useUI((s) => s.setAccent);
  const density = useUI((s) => s.density);
  const setDensity = useUI((s) => s.setDensity);
  const radiusStyle = useUI((s) => s.radiusStyle);
  const setRadius = useUI((s) => s.setRadius);

  const [showSplash, setSplash] = useState(true);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    void readShowSplash().then(setSplash);
  }, []);

  return (
    <>
      <div className="settings-row" data-setting="appearance-dark">
        <span className="settings-label">Dark mode</span>
        <div className="settings-control">
          <Switch
            checked={resolvedTheme === "dark"}
            label="Dark mode"
            onChange={(on) => setTheme(on ? "dark" : "light")}
          />
          <span className="settings-value">
            {resolvedTheme === "dark" ? <Moon size={11} /> : <Sun size={11} />}
            {resolvedTheme === "dark" ? "On" : "Off"}
          </span>
        </div>
      </div>
      <div className="settings-row" data-setting="appearance-system">
        <span className="settings-label">Follow system</span>
        <div className="settings-control">
          <Switch
            checked={theme === "system"}
            label="Follow system appearance"
            onChange={(on) => setTheme(on ? "system" : theme === "system" ? "dark" : theme)}
          />
          <span className="settings-value">{theme === "system" ? "Synced" : "Manual"}</span>
        </div>
      </div>
      <div className="faint settings-hint">
        Dark is the default. Follow system overrides the toggle above.
      </div>

      <div className="settings-row" data-setting="appearance-welcome">
        <span className="settings-label">Welcome screen</span>
        <div className="settings-control">
          <Switch
            checked={showSplash}
            label="Show the welcome screen on launch"
            onChange={(on) => {
              setSplash(on);
              void setShowSplash(on);
            }}
          />
          <span className="settings-value">{showSplash ? "On launch" : "Off"}</span>
        </div>
      </div>
      <div className="faint settings-hint">
        The brief card that names the app and the build when Tempo opens.
      </div>

      <div className="settings-row" data-setting="appearance-accent">
        <span className="settings-label">Accent</span>
        <div className="settings-control">
          <div className="swatches">
            {PALETTE.map((color) => (
              <button
                key={color}
                className="swatch"
                data-active={accent.toLowerCase() === color.toLowerCase()}
                style={{ background: color }}
                onClick={() => setAccent(color)}
                title={color}
              />
            ))}
          </div>
          <input
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            style={{ width: 24, height: 22, border: "none", background: "none", padding: 0 }}
            title="Custom accent"
          />
        </div>
      </div>

      <div className="settings-row" data-setting="appearance-density">
        <span className="settings-label">Density</span>
        <div className="settings-control">
          <div className="seg">
            {(["comfortable", "compact"] as const).map((d) => (
              <button key={d} data-active={density === d} onClick={() => setDensity(d)}>
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-row" data-setting="appearance-corners">
        <span className="settings-label">Corners</span>
        <div className="settings-control">
          <div className="seg">
            {(["soft", "square", "round"] as const).map((r) => (
              <button key={r} data-active={radiusStyle === r} onClick={() => setRadius(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function NavOrderList({
  settingId,
  title,
  hint,
  ids,
  hidden,
  limit,
  onOrder,
  onToggle,
}: {
  settingId: string;
  title: string;
  hint: string;
  ids: PaneKind[];
  hidden: PaneKind[];
  /** A cap on visible entries; the phone bar allows four beside More. */
  limit?: number;
  onOrder: (order: PaneKind[]) => void;
  onToggle: (id: PaneKind) => void;
}) {
  const shown = ids.filter((id) => !hidden.includes(id));

  return (
    <div className="nav-custom" data-setting={settingId}>
      <div className="nav-custom-head">
        <span className="settings-label">{title}</span>
        <span className="settings-value">
          {limit == null ? `${shown.length} shown` : `${shown.length} of ${limit} in the bar`}
        </span>
      </div>
      <div className="faint nav-custom-hint">{hint}</div>

      <div className="nav-custom-list">
        {ids.map((id, index) => {
          const def = navView(id);
          if (!def) return null;
          const Icon = def.icon;
          const on = !hidden.includes(id);
          const full = limit != null && shown.length >= limit && !on;
          const last = limit != null && on && shown.length <= 1;
          const why = last
            ? "Keep at least one view in the bar"
            : full
              ? "Bar is full — turn another off first"
              : on
                ? limit == null
                  ? "Shown in the sidebar"
                  : `Position ${shown.indexOf(id) + 1} of ${limit}`
                : limit == null
                  ? "Hidden from the sidebar"
                  : "Hidden — listed under More";
          const move = (dir: -1 | 1) => {
            const next = [...ids];
            const [moved] = next.splice(index, 1);
            next.splice(index + dir, 0, moved);
            onOrder(next);
          };
          return (
            <div className="nav-custom-row" data-on={on} key={id}>
              <span className="nav-custom-icon" aria-hidden>
                <Icon size={15} />
              </span>
              <span className="nav-custom-text">
                <span className="nav-custom-label">{def.label}</span>
                <span className="nav-custom-why">{why}</span>
              </span>
              <span className="nav-custom-move">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move ${def.label} up`}
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => move(-1)}
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move ${def.label} down`}
                  title="Move down"
                  disabled={index === ids.length - 1}
                  onClick={() => move(1)}
                >
                  <ChevronDown size={13} />
                </button>
              </span>
              <Switch
                checked={on}
                label={`Show ${def.label}`}
                disabled={full || last}
                onChange={() => onToggle(id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NavigationPane() {
  const mobile = useIsMobile();
  const [tab, setTab] = useState<"bar" | "rail">("bar");
  const mobileOrder = useUI((s) => s.mobileOrder);
  const mobileHidden = useUI((s) => s.mobileHidden);
  const railOrder = useUI((s) => s.railOrder);
  const railHidden = useUI((s) => s.railHidden);
  const setMobileOrder = useUI((s) => s.setMobileOrder);
  const toggleMobileView = useUI((s) => s.toggleMobileView);
  const setRailOrder = useUI((s) => s.setRailOrder);
  const toggleRailView = useUI((s) => s.toggleRailView);
  const resetNavigation = useUI((s) => s.resetNavigation);

  return (
    <>
      {mobile && (
        <TabStrip
          value={tab}
          onChange={setTab}
          ariaLabel="Navigation sections"
          tabs={[
            { id: "bar", label: "Bottom bar" },
            { id: "rail", label: "Sidebar" },
          ]}
        />
      )}

      {/* Desktop shows both lists stacked, so the sidebar it is currently
          using comes first; the phone's tabs lead when the strip is in use. */}
      <div
        className="settings-subpanel"
        data-mobile-panel="rail"
        hidden={mobile && tab !== "rail"}
      >
        <NavOrderList
          settingId="navigation-sidebar"
          title="Desktop sidebar"
          hint="Every view can be shown. Hidden ones stay reachable from search (⌘K)."
          ids={railOrder}
          hidden={railHidden}
          onOrder={setRailOrder}
          onToggle={toggleRailView}
        />
      </div>

      <div
        className="settings-subpanel"
        data-mobile-panel="bar"
        hidden={mobile && tab !== "bar"}
      >
        <NavOrderList
          settingId="navigation-bar"
          title="Phone bottom bar"
          hint="Up to four views fit beside More. Anything you turn off moves to More, still one tap away."
          ids={mobileOrder}
          hidden={mobileHidden}
          limit={MOBILE_BAR_LIMIT}
          onOrder={setMobileOrder}
          onToggle={toggleMobileView}
        />
      </div>

      <div className="nav-custom-reset">
        <button
          className="btn sm subtle"
          data-setting="navigation-reset"
          onClick={resetNavigation}
        >
          <RotateCcw size={11} /> Reset navigation
        </button>
        <span className="faint nav-custom-hint">
          Each device keeps its own navigation, like the rest of its appearance.
        </span>
      </div>
    </>
  );
}

function CalendarPane() {
  const weekStart = useUI((s) => s.weekStart);
  const setWeekStart = useUI((s) => s.setWeekStart);
  const timeFormat = useUI((s) => s.timeFormat);
  const setTimeFormat = useUI((s) => s.setTimeFormat);
  const dayStartHour = useUI((s) => s.dayStartHour);
  const dayEndHour = useUI((s) => s.dayEndHour);
  const setDayHours = useUI((s) => s.setDayHours);
  const hourChoices = hourOptions(timeFormat);

  return (
    <>
      <div className="settings-row" data-setting="calendar-time">
        <span className="settings-label">24-hour time</span>
        <div className="settings-control">
          <Switch
            checked={timeFormat === "24h"}
            label="Use a 24-hour clock"
            onChange={(on) => setTimeFormat(on ? "24h" : "12h")}
          />
          <span className="settings-value">{timeFormat === "24h" ? "14:30" : "2:30 PM"}</span>
        </div>
      </div>
      <div className="faint settings-hint">
        Applies to every time field and label, from the calendar to the editors and status
        bar.
      </div>

      <div className="settings-row" data-setting="calendar-week">
        <span className="settings-label">Week starts Sunday</span>
        <div className="settings-control">
          <Switch
            checked={weekStart === 0}
            label="First day of the week is Sunday"
            onChange={(on) => setWeekStart(on ? 0 : 1)}
          />
          <span className="settings-value">{weekStart === 0 ? "Sunday" : "Monday"}</span>
        </div>
      </div>
      <div className="faint settings-hint">
        Sets the first column of the week and month grids.
      </div>

      <div className="settings-row" data-setting="calendar-hours">
        <span className="settings-label">Visible hours</span>
        <div className="settings-control">
          <Select
            value={String(dayStartHour)}
            ariaLabel="Day starts at"
            style={{ width: 84, flex: "none" }}
            options={hourChoices}
            onChange={(v) => setDayHours(Number(v), dayEndHour)}
          />
          <span className="faint">to</span>
          <Select
            value={String(dayEndHour)}
            ariaLabel="Day ends at"
            style={{ width: 84, flex: "none" }}
            options={hourChoices}
            onChange={(v) => setDayHours(dayStartHour, Number(v))}
          />
        </div>
      </div>
    </>
  );
}

function TasksPane() {
  const keepOverdue = useUI((s) => s.keepOverdue);
  const setKeepOverdue = useUI((s) => s.setKeepOverdue);

  return (
    <>
      <div className="settings-row" data-setting="tasks-overdue">
        <span className="settings-label">Persistent overdue</span>
        <div className="settings-control">
          <Switch
            checked={keepOverdue}
            label="Keep overdue tasks visible"
            onChange={setKeepOverdue}
          />
          <span className="settings-value">
            {keepOverdue ? "Always shown" : "Follow calendars"}
          </span>
        </div>
      </div>
      <div className="faint settings-hint">
        Overdue tasks stay in Tasks and Today even when their calendar is hidden.
      </div>
    </>
  );
}

function NotificationsPane() {
  const [permission, setPermission] = useState<PermissionState>("default");

  useEffect(() => {
    void checkNotificationPermission().then(setPermission);
  }, []);

  return (
    <>
      <div className="settings-row" data-setting="notifications-alerts">
        <span className="settings-label">System alerts</span>
        <div className="settings-control">
          <span className="chip">
            <Bell size={10} /> {permission}
          </span>
          {permission !== "granted" && permission !== "unsupported" && (
            <button
              className="btn sm"
              onClick={async () => setPermission(await requestNotificationPermission())}
            >
              Enable
            </button>
          )}
          {permission === "unsupported" && (
            <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
              In-app reminders only
            </span>
          )}
        </div>
      </div>
      <div className="faint settings-hint">
        Reminders always appear in-app; system alerts are best effort.
      </div>
    </>
  );
}

type DataTab = "backups" | "restore" | "import" | "reset";

function DataPane() {
  const mobile = useIsMobile();
  const [tab, setTab] = useState<DataTab>("backups");

  return (
    <>
      {mobile && (
        <TabStrip
          value={tab}
          onChange={setTab}
          ariaLabel="Data sections"
          tabs={[
            { id: "backups", label: "Backups" },
            { id: "restore", label: "Restore" },
            { id: "import", label: "Import" },
            { id: "reset", label: "Reset" },
          ]}
        />
      )}
      <div
        className="settings-subpanel"
        data-mobile-panel="backups"
        hidden={mobile && tab !== "backups"}
      >
        <BackupSettings />
      </div>
      <div
        className="settings-subpanel"
        data-mobile-panel="restore"
        hidden={mobile && tab !== "restore"}
      >
        <BackupRestore />
      </div>
      <div
        className="settings-subpanel"
        data-mobile-panel="import"
        hidden={mobile && tab !== "import"}
      >
        <IcsImport />
      </div>
      <div
        className="settings-subpanel"
        data-mobile-panel="reset"
        hidden={mobile && tab !== "reset"}
      >
        <ResetData />
      </div>
      <div className="faint settings-note" data-setting="data-privacy">
        Everything lives in a local database on this device. Nothing leaves it unless you
        enable folder sync or point backups at a synced folder.
      </div>
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Search / commands", "⌘ K"],
  ["New task", "N"],
  ["New event", "E"],
  ["Quick add", "Q"],
  ["Jump to today", "T / Home"],
  ["Previous / next period", "← →  ·  [ ]"],
  ["Scroll calendar", "↑ ↓"],
  ["Scroll a page", "PgUp / PgDn"],
  ["Calendar views", "D W M Y A"],
  ["Zoom in / out", "+ / −"],
  ["Reset zoom to fit", "0"],
  ["Save editor", "⌘ ↵"],
  ["Close", "Esc"],
];

const TOUCH_GESTURES: [string, string][] = [
  ["Row actions", "Long-press a task, event, project, calendar or schedule."],
  ["New at a time", "Tap empty calendar space to add an event or task there."],
  ["Move through time", "Swipe the calendar sideways to reach another day or week."],
  ["Open something", "Tap a row, card or calendar event to open its editor."],
  [
    "Switch views",
    "Use the bottom tabs; More holds whatever you keep off the bar in Settings → Navigation.",
  ],
  [
    "Edit the bar",
    "Long-press any bottom tab to drag tabs into a new order, remove one, or add another.",
  ],
];

function ShortcutsPane() {
  const mobile = useIsMobile();

  // Keyboard chords mean nothing on a phone; show the touch equivalents instead.
  if (mobile) {
    return (
      <div className="settings-shortcuts" data-setting="shortcuts-list">
        {TOUCH_GESTURES.map(([label, how]) => (
          <div className="settings-gesture" key={label}>
            <span className="settings-gesture-label">{label}</span>
            <span className="faint settings-gesture-how">{how}</span>
          </div>
        ))}
        <div className="faint settings-hint">
          Keyboard shortcuts apply to the desktop app.
        </div>
      </div>
    );
  }

  return (
    <div className="settings-shortcuts" data-setting="shortcuts-list">
      {SHORTCUTS.map(([label, key]) => (
        <div key={label} className="row" style={{ gap: 8 }}>
          <span className="muted">{label}</span>
          <span className="spacer" />
          <span className="kbd">{key}</span>
        </div>
      ))}
    </div>
  );
}

function SearchResults({
  query,
  results,
  onPick,
}: {
  query: string;
  results: SettingsEntry[];
  onPick: (entry: SettingsEntry) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="settings-empty">
        <Search size={17} />
        <span className="settings-empty-title">No settings match “{query.trim()}”.</span>
        <span className="faint">Try “backup”, “theme” or “time”.</span>
      </div>
    );
  }

  return (
    <div className="settings-results">
      {groupSettings(results).map(({ category, entries }) => (
        <div className="settings-result-group" key={category.id}>
          <div className="settings-result-group-title">{category.label}</div>
          {entries.map((entry) => (
            <button
              key={entry.id}
              className="settings-result"
              onClick={() => onPick(entry)}
            >
              <span className="settings-result-icon">{categoryIcon(category.id)}</span>
              <span className="settings-result-text">
                <span className="settings-result-label">{entry.label}</span>
                <span className="settings-result-description">{entry.description}</span>
              </span>
              <ChevronRight size={12} className="settings-result-arrow" />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SettingsModal() {
  const close = () => useUI.getState().setSettingsOpen(false);
  const [active, setActive] = useState<SettingsCategoryId>("appearance");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchSettings(query), [query]);
  const searching = query.trim().length > 0;
  const category = settingsCategory(active);
  const counts = useMemo(() => {
    const map = new Map<SettingsCategoryId, number>();
    for (const entry of results) map.set(entry.category, (map.get(entry.category) ?? 0) + 1);
    return map;
  }, [results]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Every pane keeps its own component state while hidden, so a chosen import
  // file or an opened history list survives a trip through another category.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [active, searching]);

  useEffect(() => {
    if (!target) return;
    let timer = 0;
    let highlighted: HTMLElement | null = null;

    // A setting can live on a sub-tab that is currently hidden on a phone.
    // Switch to that tab first, then scroll once React has rendered it.
    const reveal = (): boolean => {
      const element = bodyRef.current?.querySelector<HTMLElement>(
        `[data-setting="${target}"]`,
      );
      if (!element) return false;
      const panel = element.closest<HTMLElement>("[data-mobile-panel]");
      if (panel && panel.hidden) {
        const key = panel.dataset.mobilePanel;
        bodyRef.current
          ?.querySelector<HTMLElement>(`.tabstrip [data-tab="${key}"]`)
          ?.click();
        return false;
      }
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      element.classList.add("settings-highlight");
      highlighted = element;
      timer = window.setTimeout(() => {
        element.classList.remove("settings-highlight");
        setTarget(null);
      }, 1800);
      return true;
    };

    if (!reveal()) {
      let attempts = 0;
      const tick = () => {
        attempts += 1;
        if (reveal() || attempts > 4) return;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    return () => {
      window.clearTimeout(timer);
      highlighted?.classList.remove("settings-highlight");
    };
  }, [target]);

  const chooseCategory = (id: SettingsCategoryId) => {
    setActive(id);
    setQuery("");
    setTarget(null);
  };

  const goToSetting = (entry: SettingsEntry) => {
    setActive(entry.category);
    setQuery("");
    setTarget(entry.id);
  };

  const clearSearch = () => {
    setQuery("");
    searchRef.current?.focus();
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal settings-modal">
        <div className="modal-head">
          <span className="modal-title">Settings</span>
          <div className="spacer" />
          <button className="icon-btn" onClick={close} aria-label="Close settings">
            <X size={15} />
          </button>
        </div>

        <div className="settings-shell">
          <aside className="settings-nav">
            <div className="settings-search">
              <Search size={12} className="settings-search-icon" />
              <input
                ref={searchRef}
                className="settings-search-input"
                type="text"
                value={query}
                placeholder="Search settings"
                aria-label="Search settings"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    // Keep a searched dialog open: the first Escape clears.
                    event.stopPropagation();
                    event.preventDefault();
                    clearSearch();
                    return;
                  }
                  if (event.key === "Enter" && results.length > 0) {
                    event.preventDefault();
                    goToSetting(results[0]);
                  }
                }}
              />
              {query && (
                <button
                  className="settings-search-clear"
                  onClick={clearSearch}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            <nav className="settings-nav-list" aria-label="Settings categories">
              {SETTINGS_CATEGORIES.map((item) => {
                const count = counts.get(item.id) ?? 0;
                return (
                  <button
                    key={item.id}
                    className="settings-nav-item"
                    data-active={!searching && active === item.id}
                    data-muted={searching && count === 0}
                    aria-current={!searching && active === item.id ? "page" : undefined}
                    onClick={() => chooseCategory(item.id)}
                  >
                    {categoryIcon(item.id)}
                    <span>{item.label}</span>
                    {searching && <span className="settings-nav-count">{count}</span>}
                  </button>
                );
              })}
            </nav>

            <div className="settings-nav-foot">
              <span>Tempo {VERSION_LABEL}</span>
              <span>Local-first, no account</span>
            </div>
          </aside>

          <section className="settings-content">
            <header className="settings-content-head">
              <span className="settings-content-title">
                {searching ? "Search results" : category.label}
              </span>
              <span className="settings-content-sub">
                {searching
                  ? `${results.length} ${results.length === 1 ? "setting" : "settings"} matching “${query.trim()}”`
                  : category.blurb}
              </span>
            </header>

            <div className="settings-body" ref={bodyRef}>
              {searching && <SearchResults query={query} results={results} onPick={goToSetting} />}

              <div className="settings-panes" hidden={searching}>
                <div className="settings-pane" hidden={active !== "appearance"}>
                  <AppearancePane />
                </div>
                <div className="settings-pane" hidden={active !== "navigation"}>
                  <NavigationPane />
                </div>
                <div className="settings-pane" hidden={active !== "calendar"}>
                  <CalendarPane />
                </div>
                <div className="settings-pane" hidden={active !== "tasks"}>
                  <TasksPane />
                </div>
                <div className="settings-pane" hidden={active !== "notifications"}>
                  <NotificationsPane />
                </div>
                <div className="settings-pane" hidden={active !== "sync"}>
                  <SyncSettings visible={!searching && active === "sync"} />
                </div>
                <div className="settings-pane" hidden={active !== "data"}>
                  <DataPane />
                </div>
                <div className="settings-pane" hidden={active !== "shortcuts"}>
                  <ShortcutsPane />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
