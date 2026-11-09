import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Command,
  Layers,
  Moon,
  Search,
  Sun,
  SunMoon,
} from "lucide-react";
import { useUI, PRESETS } from "../../store/ui";
import { eod, rangeLabel } from "../../lib/date";
import { addDays, endOfMonth, endOfWeek, endOfYear, startOfMonth, startOfWeek, startOfYear } from "date-fns";
import { AboutPopover } from "./AboutPopover";

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.4V12l3.1 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="3.4" r="1.5" fill="currentColor" />
    </svg>
  );
}

function visibleRange(): { from: number; to: number } {
  const { calendarMode, anchorDate, weekStart } = useUI.getState();
  if (calendarMode === "day") {
    const start = anchorDate;
    return { from: start, to: eod(start) };
  }
  if (calendarMode === "month") {
    return {
      from: startOfWeek(startOfMonth(anchorDate), { weekStartsOn: weekStart }).getTime(),
      to: endOfWeek(endOfMonth(anchorDate), { weekStartsOn: weekStart }).getTime(),
    };
  }
  if (calendarMode === "agenda") {
    return { from: anchorDate, to: eod(addDays(new Date(anchorDate), 29).getTime()) };
  }
  if (calendarMode === "year") {
    const from = startOfYear(anchorDate).getTime();
    return { from, to: endOfYear(anchorDate).getTime() };
  }
  return {
    from: startOfWeek(anchorDate, { weekStartsOn: weekStart }).getTime(),
    to: endOfWeek(anchorDate, { weekStartsOn: weekStart }).getTime(),
  };
}

export function AppBar() {
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const shift = useUI((s) => s.shift);
  const goToday = useUI((s) => s.goToday);
  const setPaletteOpen = useUI((s) => s.setPaletteOpen);
  const calendarMode = useUI((s) => s.calendarMode);
  const anchorDate = useUI((s) => s.anchorDate);
  const weekStart = useUI((s) => s.weekStart);
  const applyPreset = useUI((s) => s.applyPreset);
  const presetId = useUI((s) => s.presetId);

  const [layoutOpen, setLayoutOpen] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (!layoutOpen) return;
    const close = (e: MouseEvent) => {
      if (!layoutRef.current?.contains(e.target as Node)) setLayoutOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [layoutOpen]);

  useEffect(() => {
    if (!aboutOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setAboutOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [aboutOpen]);

  const range = visibleRange();
  const label =
    calendarMode === "agenda"
      ? "Next 30 days"
      : calendarMode === "year"
        ? String(new Date(anchorDate).getFullYear())
        : calendarMode === "month"
          ? new Date(anchorDate).toLocaleDateString(undefined, { month: "long", year: "numeric" })
          : rangeLabel(range.from, range.to);
  void anchorDate;
  void weekStart;

  return (
    <header className="topbar">
      <div className="brand-anchor no-drag">
        <button
          className="brand"
          onClick={() => setAboutOpen((open) => !open)}
          title="About Tempo"
          aria-label="About Tempo"
          aria-haspopup="dialog"
          aria-expanded={aboutOpen}
        >
          <BrandMark />
          <span className="brand-name">
            Tempo <span>·</span>
          </span>
        </button>
        {aboutOpen && <AboutPopover onClose={() => setAboutOpen(false)} />}
      </div>

      <div className="topbar-center no-drag">
        <button
          className="icon-btn"
          onClick={() => shift(-1)}
          title="Previous (← or [)"
          aria-label="Previous"
        >
          <ChevronLeft size={15} />
        </button>
        <button className="btn sm" onClick={goToday} title="Jump to today (T or Home)">
          Today
        </button>
        <button
          className="icon-btn"
          onClick={() => shift(1)}
          title="Next (→ or ])"
          aria-label="Next"
        >
          <ChevronRight size={15} />
        </button>
        <div className="topbar-date">{label}</div>
      </div>

      <div className="spacer" />

      <button className="searchbtn no-drag" onClick={() => setPaletteOpen(true)}>
        <Search size={13} />
        <span>Search</span>
        <span className="kbd">
          <Command size={9} style={{ verticalAlign: "-1px" }} /> K
        </span>
      </button>

      <div className="no-drag layout-anchor" ref={layoutRef}>
        <button
          className="icon-btn"
          onClick={() => setLayoutOpen((v) => !v)}
          title="Layout"
          data-active={layoutOpen}
        >
          <Layers size={15} />
        </button>
        {layoutOpen && (
          <div className="popover topbar-popover" style={{ width: 248 }}>
            <div className="menu-label">Workspace layout</div>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className="menu-item"
                onClick={() => {
                  applyPreset(p.id);
                  setLayoutOpen(false);
                }}
              >
                <CalendarDays size={13} style={{ opacity: 0 }} />
                <div style={{ flex: 1 }}>
                  <div>{p.label}</div>
                  <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                    {p.hint}
                  </div>
                </div>
                {presetId === p.id && <Check size={13} style={{ color: "var(--accent-ink)" }} />}
              </button>
            ))}
            <div className="menu-sep" />
            <div className="menu-item" style={{ color: "var(--text-3)", pointerEvents: "none" }}>
              Drag pane edges to resize
            </div>
          </div>
        )}
      </div>

      <button
        className="icon-btn no-drag"
        onClick={toggleTheme}
        title={
          theme === "system"
            ? "Following system appearance — click to switch to light"
            : theme === "dark"
              ? "Dark mode on — switch to light"
              : "Light mode on — switch to dark"
        }
        aria-label="Toggle dark mode"
      >
        {theme === "dark" ? (
          <Moon size={15} />
        ) : theme === "light" ? (
          <Sun size={15} />
        ) : (
          <SunMoon size={15} />
        )}
      </button>
    </header>
  );
}
