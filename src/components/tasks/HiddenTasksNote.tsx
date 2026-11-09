import { EyeOff } from "lucide-react";

interface Props {
  count: number;
  /** Names of the calendars currently hidden. */
  calendars: string[];
}

/**
 * Hidden calendars take their tasks out of a view, but not out of mind. This
 * keeps the count in sight so an empty list is explained, and names the
 * calendars doing it so the eye that undoes it is easy to find.
 */
export function HiddenTasksNote({ count, calendars }: Props) {
  if (count === 0 || calendars.length === 0) return null;
  const where =
    calendars.length === 1 ? calendars[0] : `${calendars[0]} +${calendars.length - 1}`;
  return (
    <div
      className="hidden-note"
      title={`Hidden with ${calendars.join(", ")} — use the eye in the sidebar to show`}
    >
      <EyeOff size={11} />
      <span>
        {count} open {count === 1 ? "task" : "tasks"} hidden
      </span>
      <span className="hidden-note-where">· {where}</span>
    </div>
  );
}
