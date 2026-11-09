import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ListFilter, X } from "lucide-react";
import type { TaskSort } from "../../store/ui";
import { tagColor, type TagUsage } from "../../lib/tags";
import { useIsMobile } from "../../hooks/useIsMobile";
import { SheetDragHandle } from "../ui/SheetDragHandle";
import { openTagMenu } from "../../store/contextMenu";

const SORTS: { id: TaskSort; label: string }[] = [
  { id: "default", label: "Manual" },
  { id: "due", label: "Due date" },
  { id: "priority", label: "Priority" },
  { id: "tag", label: "Tag" },
  { id: "title", label: "Title" },
  { id: "created", label: "Newest" },
];

const GAP = 6;
const PAD = 8;
const MENU_WIDTH = 286;
const MAX_MENU_HEIGHT = 440;

interface Props {
  sort: TaskSort;
  onSort: (sort: TaskSort) => void;
  tags: TagUsage[];
  tagId: string | null;
  onTag: (id: string | null) => void;
}

interface Position {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

/**
 * One compact menu for both ordering and tag filtering. The phone reaches
 * tags only through this menu; the desktop rail is a second, more visual way
 * in. It is portalled so the horizontally scrolling task toolbar cannot clip
 * it, and becomes a bottom sheet on a phone.
 */
export function TaskViewMenu({ sort, onSort, tags, tagId, onTag }: Props) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedTag = tags.find((entry) => entry.tag.id === tagId);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(MENU_WIDTH, window.innerWidth - PAD * 2);
    const below = window.innerHeight - rect.bottom - GAP - PAD;
    const above = rect.top - GAP - PAD;
    const placement: Position["placement"] = below < 260 && above > below ? "top" : "bottom";
    const left = Math.min(
      Math.max(PAD, rect.right - width),
      Math.max(PAD, window.innerWidth - width - PAD),
    );
    setPos({
      left,
      width,
      top: placement === "bottom" ? rect.bottom + GAP : undefined,
      bottom: placement === "top" ? window.innerHeight - rect.top + GAP : undefined,
      maxHeight: Math.max(180, Math.min(MAX_MENU_HEIGHT, placement === "top" ? above : below)),
      placement,
    });
  }, []);

  const show = () => {
    measure();
    setOpen(true);
  };

  const close = useCallback((focus = false) => {
    setOpen(false);
    setPos(null);
    if (focus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || mobile) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, mobile, measure]);

  useLayoutEffect(() => {
    if (open) menuRef.current?.focus({ preventScroll: true });
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  useEffect(() => {
    if (!open || mobile) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, mobile, close]);

  const chooseSort = (next: TaskSort) => {
    onSort(next);
    close(true);
  };

  const chooseTag = (next: string | null) => {
    onTag(next);
    close(true);
  };

  const body = (
    <div className="task-view-body">
      <div className="task-view-heading">
        <span>View tasks</span>
        <button className="icon-btn" onClick={() => close(true)} aria-label="Close sort menu">
          <X size={13} />
        </button>
      </div>

      <div className="task-view-label">Sort</div>
      <div className="task-view-sorts" role="radiogroup" aria-label="Sort tasks">
        {SORTS.map((option) => (
          <button
            key={option.id}
            className="task-view-sort"
            data-active={sort === option.id}
            role="radio"
            aria-checked={sort === option.id}
            onClick={() => chooseSort(option.id)}
          >
            <span>{option.label}</span>
            {sort === option.id && <Check size={11} />}
          </button>
        ))}
      </div>

      <div className="task-view-sep" />
      <div className="task-view-label-row">
        <span className="task-view-label">Filter by tag</span>
        {tagId && (
          <button className="task-view-clear" onClick={() => chooseTag(null)}>
            Clear
          </button>
        )}
      </div>

      <div className="task-view-tags" role="listbox" aria-label="Filter tasks by tag">
        <button
          className="task-view-tag task-view-all"
          data-selected={!tagId}
          role="option"
          aria-selected={!tagId}
          onClick={() => chooseTag(null)}
        >
          <span className="task-view-hash">#</span>
          <span className="task-view-tag-name">All tags</span>
          {!tagId && <Check size={11} />}
        </button>

        {tags.map((entry, index) => {
          const selected = entry.tag.id === tagId;
          return (
            <button
              key={entry.tag.id}
              className="task-view-tag"
              data-selected={selected}
              role="option"
              aria-selected={selected}
              style={
                {
                  "--tag-color": tagColor(entry.tag),
                  animationDelay: `${Math.min(index, 12) * 16}ms`,
                } as CSSProperties
              }
              title={`${entry.tasks.length} ${entry.tasks.length === 1 ? "task" : "tasks"} · ${
                entry.events.length
              } ${entry.events.length === 1 ? "event" : "events"} · right-click to edit`}
              onClick={() => chooseTag(entry.tag.id)}
              onContextMenu={(event) => {
                close();
                openTagMenu(event, entry.tag.id);
              }}
            >
              <span className="task-view-hash">#</span>
              <span className="task-view-tag-name">{entry.tag.name}</span>
              <span className="task-view-tag-count">{entry.items.length}</span>
              {selected && <Check size={11} />}
            </button>
          );
        })}

        {tags.length === 0 && (
          <div className="task-view-empty">
            Add a #tag to a task or event and it lands here.
          </div>
        )}
      </div>

      <div className="task-view-hint">
        A tag gathers every task and event it is added to.
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="task-view-trigger"
        data-open={open}
        data-active={tagId != null}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={selectedTag ? `Sort and filter, tag ${selectedTag.tag.name}` : "Sort and filter by tag"}
        onClick={() => (open ? close() : show())}
      >
        <ListFilter size={11} />
        <span>{selectedTag ? `#${selectedTag.tag.name}` : "Sort & tags"}</span>
        <ChevronDown size={11} className="task-view-chevron" />
      </button>

      {open &&
        createPortal(
          mobile ? (
            <div
              className="task-view-backdrop"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) close(true);
              }}
            >
              <div
                ref={menuRef}
                className="task-view-menu task-view-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="Sort and filter tasks"
                tabIndex={-1}
              >
                <SheetDragHandle
                  sheetRef={menuRef}
                  enabled={mobile}
                  onDismiss={() => close(true)}
                  className="task-view-swipe"
                />
                {body}
              </div>
            </div>
          ) : pos ? (
            <div
              ref={menuRef}
              className="task-view-menu"
              role="dialog"
              aria-label="Sort and filter tasks"
              data-placement={pos.placement}
              tabIndex={-1}
              style={{
                left: pos.left,
                width: pos.width,
                top: pos.top,
                bottom: pos.bottom,
                maxHeight: pos.maxHeight,
              }}
            >
              {body}
            </div>
          ) : null,
          document.querySelector(".app") ?? document.body,
        )}
    </>
  );
}
