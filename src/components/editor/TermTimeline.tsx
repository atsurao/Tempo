import type { ScheduleBreak } from "../../types";
import { DAY, sod } from "../../lib/date";
import { breakDays, breakRangeLabel, termBreakSpans, termMonths } from "../../lib/schedule";

/** A break as this strip needs it: a span, and a name for the tooltip. */
export type TimelineBreak = Pick<ScheduleBreak, "id" | "label" | "from" | "to">;

interface Props {
  /** First and last day of the term, as day starts. */
  from: number;
  to: number;
  breaks: TimelineBreak[];
  color?: string;
  /** Marks "today" when it falls inside the term. */
  today?: number;
}

const pct = (value: number) => `${Math.max(0, Math.min(100, value * 100)).toFixed(3)}%`;

/** Days of a break that fall inside the term. */
function daysInside(span: { from: number; to: number }, brk: TimelineBreak): number {
  const from = Math.max(span.from, sod(brk.from));
  const to = Math.min(span.to, Math.max(sod(brk.from), sod(brk.to)));
  return to < from ? 0 : Math.round((to - from) / DAY) + 1;
}

/**
 * A term on one strip: every week it runs, with the breaks cut out of it, so
 * the shape of a year — where the holidays land, how long each one is — is one
 * glance wide. Used both while editing a timetable and when reading it back.
 */
export function TermTimeline({ from, to, breaks, color = "var(--accent)", today }: Props) {
  const start = sod(from);
  const end = Math.max(start, sod(to));
  const total = end - start + DAY;
  const span = { from: start, to: end };

  const spans = termBreakSpans(span, breaks);

  // A label every month is usually too many for a term-wide strip: the first
  // one always lands and the rest only when they have room to read.
  const ticks: { key: string; label: string; left: number }[] = [];
  for (const month of termMonths(span)) {
    const previous = ticks[ticks.length - 1];
    if (previous && month.left - previous.left < 0.07) continue;
    ticks.push(month);
  }

  const todayLeft =
    today != null && sod(today) >= start && sod(today) <= end ? (sod(today) - start) / total : null;
  const daysOff = breaks.reduce((sum, brk) => sum + daysInside(span, brk), 0);

  return (
    <div className="term-strip" style={{ ["--term-color" as string]: color }}>
      <div className="term-track">
        {spans.map(({ brk, left, right, clipped }) => (
          <span
            key={brk.id}
            className="term-break"
            data-clipped={clipped}
            style={{ left: pct(left), width: pct(Math.max(right - left, 0.006)) }}
            title={`${brk.label || "Break"} · ${breakRangeLabel(brk)} · ${breakDays(brk)}d${
              clipped ? " · runs past the term" : ""
            }`}
          />
        ))}
        {todayLeft != null && <span className="term-today" style={{ left: pct(todayLeft) }} />}
      </div>
      <div className="term-months">
        {ticks.map((month) => (
          <span key={month.key} className="term-month" style={{ left: pct(month.left) }}>
            {month.label}
          </span>
        ))}
        <span className="term-total">
          {spans.length === 0
            ? "No breaks yet"
            : `${spans.length} break${spans.length === 1 ? "" : "s"} · ${daysOff} day${daysOff === 1 ? "" : "s"} off`}
        </span>
      </div>
    </div>
  );
}
