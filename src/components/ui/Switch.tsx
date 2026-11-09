import type { ReactNode } from "react";

/** The app's switch: a button wearing role="switch", used by Settings and setup. */
export function Switch({
  checked,
  label,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  label: string;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-on={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      {children}
      <span className="switch-knob" />
    </button>
  );
}
