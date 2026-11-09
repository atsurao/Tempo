import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  CalendarClock,
  CalendarDays,
  ChevronRight,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { useUI, type PaneKind } from "../../store/ui";
import { useOpenView } from "../../store/nav";
import {
  MOBILE_BAR_LIMIT,
  moveView,
  reorderVisible,
  visibleViews,
} from "../../lib/navPrefs";
import { navView } from "./navViews";

const HOLD_MS = 450;
const MOVE_TOLERANCE = 10;
const DRAG_TOLERANCE = 5;

interface DragState {
  id: PaneKind;
  pointerId: number;
  startX: number;
  left: number;
  slotWidth: number;
  /** The visible order when the drag began; target slots index into it. */
  order: PaneKind[];
  moved: boolean;
  /** The last reordered list, committed on release. */
  result: PaneKind[] | null;
}

/**
 * The phone shell's primary navigation. Settings → Navigation decides which
 * views sit in the bar; here a long press turns the bar itself into an editor:
 * drag tabs to reorder them, tap × to move one under More, or add a view back.
 */
export function MobileTabs() {
  const activeView = useUI((s) => s.activeView);
  const settingsOpen = useUI((s) => s.settingsOpen);
  const mobileOrder = useUI((s) => s.mobileOrder);
  const mobileHidden = useUI((s) => s.mobileHidden);
  const setMobileOrder = useUI((s) => s.setMobileOrder);
  const toggleMobileView = useUI((s) => s.toggleMobileView);
  const setSettingsOpen = useUI((s) => s.setSettingsOpen);
  const setCollectionMenu = useUI((s) => s.setCollectionMenu);
  const goToday = useUI((s) => s.goToday);
  const setFilterProject = useUI((s) => s.setFilterProject);
  const setFilterTag = useUI((s) => s.setFilterTag);
  const openView = useOpenView();
  const [moreOpen, setMoreOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<PaneKind[] | null>(null);
  const [draggingId, setDraggingId] = useState<PaneKind | null>(null);

  const navRef = useRef<HTMLElement>(null);
  const holdRef = useRef<number | null>(null);
  const holdStart = useRef({ x: 0, y: 0 });
  const dragRef = useRef<DragState | null>(null);

  const tabs = visibleViews(mobileOrder, mobileHidden);
  const shown = draft ?? tabs;
  const moreViews = mobileOrder.filter((id) => !tabs.includes(id));

  const clearHold = () => {
    if (holdRef.current != null) window.clearTimeout(holdRef.current);
    holdRef.current = null;
  };

  const finishEditing = () => {
    clearHold();
    dragRef.current = null;
    setDraft(null);
    setDraggingId(null);
    setAddOpen(false);
    setEditing(false);
  };

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (addOpen) setAddOpen(false);
      else finishEditing();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // finishEditing only touches state setters and refs.
  }, [editing, addOpen]);

  useEffect(
    () => () => {
      if (holdRef.current != null) window.clearTimeout(holdRef.current);
    },
    [],
  );

  // Settings has its own copy of this list; leave the bar tidy behind it.
  useEffect(() => {
    if (!settingsOpen) return;
    setMoreOpen(false);
    setEditing(false);
    setAddOpen(false);
    setDraft(null);
    setDraggingId(null);
    dragRef.current = null;
  }, [settingsOpen]);

  const open = (kind: PaneKind) => {
    setMoreOpen(false);
    setFilterProject(null);
    setFilterTag(null);
    openView(kind);
  };

  const openToday = () => {
    setFilterProject(null);
    setFilterTag(null);
    goToday();
    openView("today");
  };

  /** A held finger turns the bar into its editor after the usual delay. */
  const startHold = (event: ReactPointerEvent<HTMLElement>) => {
    if (editing) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearHold();
    holdStart.current = { x: event.clientX, y: event.clientY };
    holdRef.current = window.setTimeout(() => {
      holdRef.current = null;
      setMoreOpen(false);
      setEditing(true);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(8);
      }
    }, HOLD_MS);
  };

  const moveHold = (event: ReactPointerEvent<HTMLElement>) => {
    if (holdRef.current == null) return;
    if (
      Math.abs(event.clientX - holdStart.current.x) > MOVE_TOLERANCE ||
      Math.abs(event.clientY - holdStart.current.y) > MOVE_TOLERANCE
    ) {
      clearHold();
    }
  };

  /**
   * Tabs are equal-width flex items, so the target slot is a division of the
   * bar rather than a hit test against moving DOM nodes. That keeps a live
   * reorder from chasing its own layout.
   */
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>, id: PaneKind) => {
    if (!editing || addOpen) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const bar = navRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      left: rect.left,
      slotWidth: rect.width / Math.max(1, tabs.length),
      order: [...tabs],
      moved: false,
      result: null,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic or already-lost pointer cannot be captured; the drag
      // handlers still track it while the browser delivers the events.
    }
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.abs(event.clientX - drag.startX) < DRAG_TOLERANCE) return;
      drag.moved = true;
      setDraggingId(drag.id);
    }
    const last = drag.order.length - 1;
    const slot = Math.min(
      last,
      Math.max(0, Math.floor((event.clientX - drag.left) / drag.slotWidth)),
    );
    const next = moveView(drag.order, drag.order.indexOf(drag.id), slot);
    drag.result = next;
    setDraft(next);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
    setDraft(null);
    if (drag.moved && drag.result) {
      setMobileOrder(reorderVisible(mobileOrder, mobileHidden, drag.result));
    }
  };

  const cancelDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
    setDraft(null);
  };

  const moreActive = settingsOpen || !tabs.includes(activeView);

  return (
    <>
      {editing && (
        <div
          className="mobile-tabs-scrim"
          aria-hidden="true"
          onClick={finishEditing}
        />
      )}

      <div className="mobile-dock" data-editing={editing}>
        {editing && (
          <div className="mobile-tabs-edit">
            <span className="mobile-tabs-edit-hint">
              Drag to reorder · tap × to remove
            </span>
            <button
              className="btn sm subtle"
              onClick={() => setAddOpen(true)}
              disabled={tabs.length >= MOBILE_BAR_LIMIT}
              title={
                tabs.length >= MOBILE_BAR_LIMIT
                  ? "Remove a tab first"
                  : "Add a view to the bar"
              }
            >
              <Plus size={11} /> Add
            </button>
            <button className="btn sm primary" onClick={finishEditing}>
              Done
            </button>
          </div>
        )}

        <nav
          ref={navRef}
          className="mobile-tabs"
          data-editing={editing}
          data-longpress="off"
          aria-label={editing ? "Edit tabs" : "Primary"}
          onPointerDown={startHold}
          onPointerMove={moveHold}
          onPointerUp={clearHold}
          onPointerCancel={clearHold}
          onPointerLeave={clearHold}
        >
          {shown.map((id) => {
            const def = navView(id);
            if (!def) return null;
            const Icon = def.icon;
            const active = !settingsOpen && activeView === id;
            return (
              <div
                key={id}
                className="mobile-tab-slot"
                data-dragging={draggingId === id}
                onPointerDown={(event) => beginDrag(event, id)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={cancelDrag}
              >
                <button
                  className="mobile-tab"
                  data-active={active}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    if (editing) return;
                    if (id === "today") openToday();
                    else open(id);
                  }}
                >
                  <Icon size={21} strokeWidth={active ? 2.2 : 1.8} />
                  <span>{def.label}</span>
                </button>
                {editing && (
                  <button
                    className="mobile-tab-remove"
                    aria-label={`Remove ${def.label} from the bar`}
                    disabled={tabs.length <= 1}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleMobileView(id);
                    }}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}

          {!editing && (
            <button
              className="mobile-tab"
              data-active={moreActive && !moreOpen}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((value) => !value)}
            >
              <MoreHorizontal size={22} strokeWidth={moreActive ? 2.2 : 1.8} />
              <span>More</span>
            </button>
          )}
        </nav>
      </div>

      {moreOpen && (
        <div
          className="mobile-sheet-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setMoreOpen(false);
          }}
        >
          <div className="mobile-sheet" role="dialog" aria-label="More">
            <div className="mobile-sheet-grabber" aria-hidden />
            <div className="mobile-sheet-head">
              <div>
                <span className="mobile-sheet-title">More</span>
                <span className="mobile-sheet-sub">Views, collections and settings</span>
              </div>
              <button
                className="icon-btn"
                aria-label="Close"
                onClick={() => setMoreOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mobile-sheet-scroll">
              {moreViews.length > 0 && (
                <>
                  <div className="mobile-sheet-label">Views</div>
                  <div className="mobile-more-grid">
                    {moreViews.map((id) => {
                      const def = navView(id);
                      if (!def) return null;
                      const Icon = def.icon;
                      return (
                        <button
                          className="mobile-more-card"
                          key={id}
                          onClick={() => open(id)}
                        >
                          <span className="mobile-more-icon">
                            <Icon size={18} />
                          </span>
                          <span className="mobile-more-text">
                            <span>{def.label}</span>
                            <span>{def.hint}</span>
                          </span>
                          <ChevronRight size={15} className="mobile-more-chevron" />
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="mobile-sheet-label">Manage</div>
              <div className="mobile-more-list">
                <button
                  className="mobile-more-row"
                  onClick={() => {
                    setMoreOpen(false);
                    setCollectionMenu("calendars");
                  }}
                >
                  <CalendarDays size={17} />
                  <span>Calendars</span>
                  <span className="mobile-more-hint">Colours, visibility, delete</span>
                  <ChevronRight size={15} />
                </button>
                <button
                  className="mobile-more-row"
                  onClick={() => {
                    setMoreOpen(false);
                    setCollectionMenu("projects");
                  }}
                >
                  <LayoutGrid size={17} />
                  <span>Projects</span>
                  <span className="mobile-more-hint">Progress and team</span>
                  <ChevronRight size={15} />
                </button>
                <button
                  className="mobile-more-row"
                  onClick={() => {
                    setMoreOpen(false);
                    setCollectionMenu("schedules");
                  }}
                >
                  <CalendarClock size={17} />
                  <span>Schedules</span>
                  <span className="mobile-more-hint">Weekly timetables</span>
                  <ChevronRight size={15} />
                </button>
              </div>

              <div className="mobile-sheet-label">Tempo</div>
              <div className="mobile-more-list">
                <button
                  className="mobile-more-row"
                  onClick={() => {
                    setMoreOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  <Settings size={17} />
                  <span>Settings</span>
                  <span className="mobile-more-hint">Sync, backups, appearance</span>
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editing && addOpen && (
        <div
          className="mobile-sheet-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setAddOpen(false);
          }}
        >
          <div className="mobile-sheet" role="dialog" aria-label="Add a view">
            <div className="mobile-sheet-grabber" aria-hidden />
            <div className="mobile-sheet-head">
              <div>
                <span className="mobile-sheet-title">Add to the bar</span>
                <span className="mobile-sheet-sub">
                  Tap a view to put it beside the tabs
                </span>
              </div>
              <button
                className="icon-btn"
                aria-label="Close"
                onClick={() => setAddOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="mobile-sheet-scroll">
              <div className="mobile-sheet-label">Views</div>
              <div className="mobile-more-list">
                {moreViews.map((id) => {
                  const def = navView(id);
                  if (!def) return null;
                  const Icon = def.icon;
                  return (
                    <button
                      className="mobile-more-row"
                      key={id}
                      onClick={() => {
                        toggleMobileView(id);
                        setAddOpen(false);
                      }}
                    >
                      <Icon size={17} />
                      <span>{def.label}</span>
                      <span className="mobile-more-hint">{def.hint}</span>
                      <Plus size={15} />
                    </button>
                  );
                })}
              </div>
              {moreViews.length === 0 && (
                <div className="faint" style={{ padding: "4px 18px 12px" }}>
                  Every view is already in the bar.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
