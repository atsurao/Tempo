import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { clockMinutes } from "../../lib/clock";

interface Props {
  /** Minutes from midnight, or null when the field has no time yet. */
  value: number | null;
  onChange: (minutes: number) => void;
  ariaLabel: string;
  /** Minute choices are this far apart; the current minute is always kept. */
  step?: number;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  style?: CSSProperties;
}

interface Position {
  left: number;
  top?: number;
  bottom?: number;
}

const GAP = 4;
const PAD = 8;
const WIDTH_24 = 152;
const WIDTH_12 = 206;

/**
 * A time is picked in Tempo's own control rather than a native
 * `input[type=time]`, which follows the operating system's clock and ignores
 * the reader's 12/24-hour setting. The trigger prints the chosen style; the
 * small sheet behind it edits the same values.
 */
export function TimeField({
  value,
  onChange,
  ariaLabel,
  step = 5,
  disabled,
  invalid,
  className,
  style,
}: Props) {
  const timeFormat = useTimeFormat();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const total = value == null ? null : ((Math.round(value) % 1440) + 1440) % 1440;
  const hour = total == null ? null : Math.floor(total / 60);
  const minute = total == null ? null : total % 60;
  const meridiem = hour == null || hour < 12 ? "AM" : "PM";
  const hour12 = hour == null ? null : hour % 12 === 0 ? 12 : hour % 12;

  const hours = useMemo(() => {
    if (timeFormat === "24h") {
      return Array.from({ length: 24 }, (_, h) => ({
        value: String(h),
        label: String(h).padStart(2, "0"),
      }));
    }
    return Array.from({ length: 12 }, (_, index) => {
      const h = index + 1;
      return { value: String(h), label: String(h) };
    });
  }, [timeFormat]);

  const minutes = useMemo(() => {
    const choices = new Set<number>();
    for (let m = 0; m < 60; m += Math.max(1, step)) choices.add(m);
    if (minute != null) choices.add(minute);
    return [...choices]
      .sort((a, b) => a - b)
      .map((m) => ({ value: String(m), label: String(m).padStart(2, "0") }));
  }, [minute, step]);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const width = timeFormat === "24h" ? WIDTH_24 : WIDTH_12;
    const below = window.innerHeight - rect.bottom - GAP - PAD;
    const above = rect.top - GAP - PAD;
    const placement = below < 48 && above > below ? "top" : "bottom";
    const left = Math.min(
      Math.max(PAD, rect.left),
      Math.max(PAD, window.innerWidth - width - PAD),
    );
    setPos(
      placement === "bottom"
        ? { left, top: rect.bottom + GAP }
        : { left, bottom: window.innerHeight - rect.top + GAP },
    );
  }, [timeFormat]);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    setPos(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const show = () => {
    if (disabled) return;
    measure();
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLSelectElement>("select")?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  const setHour = (next: string) => {
    if (timeFormat === "24h") {
      onChange(Number(next) * 60 + (minute ?? 0));
      return;
    }
    const base = Number(next) % 12;
    onChange((base + (meridiem === "PM" ? 12 : 0)) * 60 + (minute ?? 0));
  };

  const setMinute = (next: string) => {
    onChange((hour ?? 9) * 60 + Number(next));
  };

  const setMeridiem = (next: string) => {
    const base = hour == null ? 9 : hour % 12;
    onChange((base + (next === "PM" ? 12 : 0)) * 60 + (minute ?? 0));
  };

  return (
    <div
      className={`time-field${className ? ` ${className}` : ""}`}
      style={style}
      data-bad={invalid || undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        className="time-trigger"
        aria-label={total == null ? ariaLabel : `${ariaLabel}, ${clockMinutes(total, timeFormat)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-open={open}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
      >
        <span className="time-value">{total == null ? "—" : clockMinutes(total, timeFormat)}</span>
        <ChevronDown className="time-chevron" size={11} aria-hidden />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            className="time-popover"
            role="dialog"
            aria-label={`${ariaLabel} picker`}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
          >
            <span className="time-select-wrap time-hour">
              <select
                className="time-select"
                aria-label={`${ariaLabel} hour`}
                value={timeFormat === "24h" ? (hour == null ? "" : String(hour)) : (hour12 == null ? "" : String(hour12))}
                onChange={(event) => setHour(event.target.value)}
              >
                <option value="" disabled>
                  —
                </option>
                {hours.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="time-select-chevron" size={10} aria-hidden />
            </span>
            <span className="time-colon" aria-hidden>
              :
            </span>
            <span className="time-select-wrap time-minute">
              <select
                className="time-select"
                aria-label={`${ariaLabel} minute`}
                value={minute == null ? "" : String(minute)}
                onChange={(event) => setMinute(event.target.value)}
              >
                <option value="" disabled>
                  —
                </option>
                {minutes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="time-select-chevron" size={10} aria-hidden />
            </span>
            {timeFormat === "12h" && (
              <span className="time-select-wrap time-meridiem">
                <select
                  className="time-select"
                  aria-label={`${ariaLabel} AM or PM`}
                  value={meridiem}
                  onChange={(event) => setMeridiem(event.target.value)}
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
                <ChevronDown className="time-select-chevron" size={10} aria-hidden />
              </span>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
