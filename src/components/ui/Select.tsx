import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

interface Position {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

const GAP = 4;
const PAD = 8;
const MAX_HEIGHT = 280;

/**
 * Dropdown that replaces the native `<select>`.
 *
 * The popup is portalled to the body so no scrolling sheet can clip it, sized
 * to the trigger, aligned to its edge, and flipped above when the space below
 * runs out. It unfolds from the trigger rather than appearing at full size.
 */
export function Select({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className,
  style,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);
  const typeahead = useRef({ text: "", at: 0 });

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder ?? "";

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const width = r.width;
    const below = window.innerHeight - r.bottom - GAP - PAD;
    const above = r.top - GAP - PAD;
    const placement: Position["placement"] = below < 160 && above > below ? "top" : "bottom";
    const left = Math.min(
      Math.max(PAD, r.left),
      Math.max(PAD, window.innerWidth - width - PAD),
    );
    const maxHeight = Math.max(120, Math.min(MAX_HEIGHT, placement === "top" ? above : below));
    setPos(
      placement === "bottom"
        ? { left, width, top: r.bottom + GAP, maxHeight, placement }
        : { left, width, bottom: window.innerHeight - r.top + GAP, maxHeight, placement },
    );
  }, []);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    setPos(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const show = useCallback(() => {
    if (disabled) return;
    const index = Math.max(0, options.findIndex((o) => o.value === value));
    setActive(index);
    // Measure in the same batch as opening, so the menu mounts already placed
    // instead of rendering one empty frame first.
    measure();
    setOpen(true);
  }, [disabled, options, value, measure]);

  // Keep following the trigger as its sheet scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  // The menu only exists once a position has been measured, so focus it after
  // that render rather than inside the effect above. Keep it focused while the
  // sheet scrolls and the menu repositions underneath it.
  useLayoutEffect(() => {
    if (!open) {
      focusedRef.current = false;
      return;
    }
    if (pos && !focusedRef.current) {
      focusedRef.current = true;
      menuRef.current?.focus({ preventScroll: true });
    }
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  // Long lists open at the current value, not always at the top.
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>(".dd-option");
    items?.[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const commit = (next: string) => {
    onChange(next);
    close(true);
  };

  const move = (delta: number) => {
    setActive((i) => (i + delta + options.length) % options.length);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    // The app listens for global shortcuts on window; a menu key must never
    // leak out, or Escape would close the editor and "n" would open a task.
    e.stopPropagation();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const option = options[active];
      if (option) commit(option.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      close();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      const text = (now - typeahead.current.at > 600 ? "" : typeahead.current.text) + e.key.toLowerCase();
      typeahead.current = { text, at: now };
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(text));
      if (hit >= 0) setActive(hit);
    }
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      show();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`dd-trigger${className ? ` ${className}` : ""}`}
        style={style}
        data-open={open}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="dd-label" title={label}>
          {label}
        </span>
        <ChevronDown className="dd-chevron" size={12} aria-hidden />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="dd-menu"
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            data-placement={pos.placement}
            style={{
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
            }}
            onKeyDown={onMenuKeyDown}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className="dd-option"
                data-selected={option.value === value}
                data-active={index === active}
                title={option.label}
                onMouseMove={() => index !== active && setActive(index)}
                onClick={() => commit(option.value)}
              >
                <span className="dd-option-label">{option.label}</span>
                {option.value === value && <Check size={12} aria-hidden />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
