import type { Goal, GoalSpan } from "../types";
import type { GoalDraft } from "../store/ui";
import { addMonths, addYears, eod, DAY, sod } from "./date";

/** The sheet's starting point when a goal is opened for editing. */
export function draftFromGoal(goal: Goal): GoalDraft {
  return {
    title: goal.title,
    body: goal.body ?? "",
    span: goal.span,
    start: goal.start,
    projectId: goal.projectId ?? null,
    color: goal.color ?? null,
  };
}

export const GOAL_SPANS: { id: GoalSpan; label: string; short: string; hint: string }[] = [
  {
    id: "month",
    label: "This month",
    short: "Month",
    hint: "A month-long push, e.g. “finish the lab report season”.",
  },
  {
    id: "year",
    label: "This year",
    short: "Year",
    hint: "A year-long goal, e.g. “get a summer internship”.",
  },
  {
    id: "open",
    label: "Until completion",
    short: "Open",
    hint: "No end date — it lasts until you mark it done.",
  },
];

export function spanLabel(span: GoalSpan): string {
  return GOAL_SPANS.find((s) => s.id === span)?.label ?? "Until completion";
}

export function spanShort(span: GoalSpan): string {
  return span === "month" ? "month" : span === "year" ? "year" : "open";
}

export function spanHint(span: GoalSpan): string {
  return GOAL_SPANS.find((s) => s.id === span)?.hint ?? "";
}

/**
 * The horizon a span implies. "until completion" has no end, which is the
 * whole point of the option: the goal only ends when the user says so.
 */
export function goalEnd(span: GoalSpan, start: number): number | null {
  // A month is "same date next month, up to the last millisecond before it".
  if (span === "month") return eod(addMonths(new Date(start), 1).getTime() - 1);
  if (span === "year") return eod(addYears(new Date(start), 1).getTime() - 1);
  return null;
}

/** A goal's stored end, falling back to the horizon its span implies. */
export function goalRange(goal: Goal): { start: number; end: number | null } {
  return { start: sod(goal.start), end: goal.end ?? goalEnd(goal.span, goal.start) };
}

export function isGoalDone(goal: Goal): boolean {
  return goal.completedAt != null;
}

export function liveGoals(goals: Goal[]): Goal[] {
  return goals.filter((g) => !g.deletedAt);
}

export function goalCoversDay(goal: Goal, dayStart: number): boolean {
  const { start, end } = goalRange(goal);
  const dayEnd = eod(dayStart);
  if (start > dayEnd) return false;
  if (end == null) return true;
  return end >= dayStart;
}

/**
 * The day a bounded goal falls due. Open goals have none: they are ongoing
 * work, not a date, so the calendar gives them no marker of their own.
 */
export function goalDeadlineKey(goal: Goal): number | null {
  const { end } = goalRange(goal);
  return end == null ? null : sod(end);
}

/** True when the goal's deadline is the given day, which must be a day start. */
export function goalDueOnDay(goal: Goal, dayStart: number): boolean {
  return goalDeadlineKey(goal) === dayStart;
}

/** Goals whose span touches [from, to]; open goals count as still running. */
export function goalsInRange(goals: Goal[], from: number, to: number): Goal[] {
  return goals.filter((goal) => {
    const { start, end } = goalRange(goal);
    if (start > to) return false;
    if (end == null) return true;
    return end >= from;
  });
}

/** Fraction of the horizon already behind us, or null for an open goal. */
export function goalElapsed(goal: Goal, now = Date.now()): number | null {
  const { start, end } = goalRange(goal);
  if (end == null || end <= start) return null;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

/** "3 weeks left", "Ended 4 days ago", or "open-ended" for goals without a horizon. */
export function goalTimeLabel(goal: Goal, now = Date.now()): string {
  const { end } = goalRange(goal);
  if (end == null) return "until done";
  const days = Math.round((end - now) / DAY);
  if (days === 0) return "last day";
  if (days === 1) return "1 day left";
  if (days > 1) return days < 45 ? `${days} days left` : `${Math.round(days / 30)} months left`;
  const past = Math.abs(days);
  return past <= 1 ? "ended yesterday" : `ended ${past} days ago`;
}

export function goalDateLabel(goal: Goal): string {
  const { start, end } = goalRange(goal);
  const from = new Date(start);
  const short = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (end == null) return `since ${short(start)} · open`;
  const sameYear = from.getFullYear() === new Date(end).getFullYear();
  const year = new Date(start).getFullYear();
  return sameYear
    ? `${short(start)} – ${short(end)}, ${year}`
    : `${short(start)} ${year} – ${short(end)} ${new Date(end).getFullYear()}`;
}

/** Active goals first, then by span (month, year, open), then by start date. */
const SPAN_ORDER: Record<GoalSpan, number> = { month: 0, year: 1, open: 2 };

export function sortGoals(goals: Goal[]): Goal[] {
  return [...goals].sort((a, b) => {
    const done = Number(isGoalDone(a)) - Number(isGoalDone(b));
    if (done !== 0) return done;
    const span = SPAN_ORDER[a.span] - SPAN_ORDER[b.span];
    if (span !== 0) return span;
    if (a.start !== b.start) return a.start - b.start;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

export function groupBySpan(goals: Goal[]): { span: GoalSpan; goals: Goal[] }[] {
  const sorted = sortGoals(goals.filter((g) => !isGoalDone(g)));
  return GOAL_SPANS.map(({ id }) => ({ span: id, goals: sorted.filter((g) => g.span === id) })).filter(
    (group) => group.goals.length > 0,
  );
}

export function resolveGoalColor(goal: Goal, projects: { id: string; color: string }[]): string {
  if (goal.color) return goal.color;
  const project = projects.find((p) => p.id === goal.projectId);
  return project?.color ?? "var(--accent)";
}
