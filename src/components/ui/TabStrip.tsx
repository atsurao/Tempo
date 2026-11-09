import type { LucideIcon } from "lucide-react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** A small count, such as the number of blocks or conflicts. */
  badge?: number;
}

interface Props<T extends string> {
  value: T;
  tabs: TabItem<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

/**
 * The phone counterpart of a long form or settings page: a few named sections
 * the thumb can switch between, instead of one tall scroll. It stays
 * horizontally scrollable so labels never have to be abbreviated.
 */
export function TabStrip<T extends string>({ value, tabs, onChange, ariaLabel }: Props<T>) {
  return (
    <div className="tabstrip" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={value === tab.id}
            className="tabstrip-tab"
            data-tab={tab.id}
            data-active={value === tab.id}
            onClick={() => onChange(tab.id)}
          >
            {Icon && <Icon size={12} />}
            <span>{tab.label}</span>
            {tab.badge != null && tab.badge > 0 && (
              <span className="tabstrip-badge">{tab.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
