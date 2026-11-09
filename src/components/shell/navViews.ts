import {
  CalendarDays,
  Flame,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  StickyNote,
  Sun,
  Target,
  Timer,
  type LucideIcon,
} from "lucide-react";
import type { PaneKind } from "../../store/ui";

export interface NavView {
  id: PaneKind;
  label: string;
  /** A short line for the More sheet and Settings → Navigation. */
  hint: string;
  icon: LucideIcon;
}

/** Every destination, in the order a brand-new workspace lists them. */
export const NAV_VIEWS: NavView[] = [
  { id: "today", label: "Today", hint: "Your day at a glance", icon: Sun },
  {
    id: "widgets",
    label: "Widgets",
    hint: "A board of glanceable cards",
    icon: LayoutDashboard,
  },
  {
    id: "calendar",
    label: "Calendar",
    hint: "Events, tasks and time blocks",
    icon: CalendarDays,
  },
  {
    id: "tasks",
    label: "Tasks",
    hint: "Everything open, by list or board",
    icon: ListTodo,
  },
  { id: "habits", label: "Habits", hint: "Daily check-ins and streaks", icon: Flame },
  {
    id: "projects",
    label: "Projects",
    hint: "Plans, teams and dependencies",
    icon: FolderKanban,
  },
  { id: "goals", label: "Goals", hint: "Longer arcs with a finish line", icon: Target },
  { id: "notes", label: "Notes", hint: "Free-form writing", icon: StickyNote },
  { id: "focus", label: "Focus", hint: "A timer for one task at a time", icon: Timer },
];

const BY_ID = new Map<string, NavView>(NAV_VIEWS.map((view) => [view.id, view]));

export function navView(id: string): NavView | undefined {
  return BY_ID.get(id);
}
