import { useLayoutEffect, useMemo, useRef } from "react";
import { format } from "date-fns";
import { Target } from "lucide-react";
import type { Goal, Item, Project } from "../../types";
import { DAY, sod } from "../../lib/date";
import { resolveColor } from "../../lib/draft";
import { isDone, isOverdue } from "../../lib/tasks";
import { goalRange, goalTimeLabel, resolveGoalColor, spanLabel } from "../../lib/goals";
import { openItemMenu, openPostponeMenu } from "../../store/contextMenu";
import { clockStamp, clockTime } from "../../lib/clock";
import { useTimeFormat } from "../../hooks/useTimeFormat";

interface Props {
  tasks: Item[];
  /** long-term goals, drawn above the tasks they belong to */
  goals: Goal[];
  projects: Project[];
  onOpen: (item: Item) => void;
  onOpenGoal: (goal: Goal) => void;
}

const DAY_W = 38;
const NAME_W = 200;
const MIN_DAYS = 14;
const MAX_DAYS = 60;

function dateRange(tasks: Item[], goals: Goal[]): { from: number; days: number } {
  const today = sod(Date.now());
  let earliest = today;
  let latest = today;
  for (const task of tasks) {
    for (const value of [task.start, task.end, task.dueAt]) {
      if (value == null) continue;
      earliest = Math.min(earliest, sod(value));
      latest = Math.max(latest, value);
    }
  }
  for (const goal of goals) {
    const { start, end } = goalRange(goal);
    earliest = Math.min(earliest, sod(start));
    latest = Math.max(latest, end ?? start);
  }
  // Keep some recent overdue history visible, but never render an endless past.
  const from = Math.max(earliest, today - 30 * DAY);
  const to = Math.max(today + MIN_DAYS * DAY, latest + DAY);
  const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.ceil((to - from) / DAY)));
  return { from, days };
}

export function TaskTimeline({ tasks, goals, projects, onOpen, onOpenGoal }: Props) {
  const { from, days } = useMemo(() => dateRange(tasks, goals), [tasks, goals]);
  const trackWidth = days * DAY_W;
  const scrollRef = useRef<HTMLDivElement>(null);
  const timeFormat = useTimeFormat();
  const todayStart = sod(Date.now());
  const winStart = from;
  const winEnd = from + days * DAY;

  /** Day cells shared by the goal rows and the task rows. */
  const trackCells = Array.from({ length: days }, (_, i) => {
    const date = new Date(from + i * DAY);
    return (
      <span
        key={i}
        className="tl-cell"
        data-weekend={[0, 6].includes(date.getDay())}
        data-today={date.getTime() === todayStart}
        style={{ left: i * DAY_W, width: DAY_W }}
      />
    );
  });

  const rows = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        const da = a.start ?? a.dueAt ?? Number.MAX_SAFE_INTEGER;
        const db = b.start ?? b.dueAt ?? Number.MAX_SAFE_INTEGER;
        if (da !== db) return da - db;
        return (a.order ?? 0) - (b.order ?? 0);
      }),
    [tasks],
  );

  // Land on today rather than on the oldest overdue task.
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    const offset = ((todayStart - from) / DAY) * DAY_W;
    scrollRef.current.scrollLeft = Math.max(0, offset - DAY_W * 2);
  }, [from, todayStart]);

  return (
    <div className="timeline">
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ width: NAME_W + trackWidth }}>
          <div className="tl-head">
            <div className="tl-corner">Timeline</div>
            <div className="tl-head-days" style={{ width: trackWidth }}>
              {Array.from({ length: days }, (_, i) => {
                const date = new Date(from + i * DAY);
                const weekend = [0, 6].includes(date.getDay());
                const today = date.getTime() === todayStart;
                return (
                  <div
                    key={i}
                    className="tl-dayhead"
                    data-weekend={weekend}
                    data-today={today}
                    style={{ left: i * DAY_W, width: DAY_W }}
                    title={format(date, "EEEE, MMMM d")}
                  >
                    <span className="dow">{format(date, "EEEEE")}</span>
                    <span className="dnum">{format(date, "d")}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {rows.length === 0 && goals.length === 0 && (
            <div className="empty" style={{ padding: "26px 14px" }}>
              <strong>Nothing to plot</strong>
              Add a task, or a goal with a span, and it lands here.
            </div>
          )}

          {goals.length > 0 && (
            <div className="tl-section" style={{ width: NAME_W }}>
              Goals
            </div>
          )}

          {goals.map((goal) => {
            const color = resolveGoalColor(goal, projects);
            const { start, end } = goalRange(goal);
            // An open goal runs off the right edge: it has no end to draw.
            const s = Math.max(start, winStart);
            const e = Math.min(end ?? winEnd, winEnd);
            const width = Math.max(8, ((e - s) / DAY) * DAY_W - 2);
            const started = start < winStart;
            const runsOn = end == null || end > winEnd;
            return (
              <div
                key={goal.id}
                className="tl-row"
                data-goal="true"
                onClick={() => onOpenGoal(goal)}
              >
                <div className="tl-name">
                  <Target size={11} style={{ color, flex: "none" }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="tl-title">{goal.title || "Untitled goal"}</div>
                    <div className="tl-meta">
                      {spanLabel(goal.span)} · {goalTimeLabel(goal)}
                    </div>
                  </div>
                </div>

                <div className="tl-track" style={{ width: trackWidth }}>
                  {trackCells}
                  <div
                    className="tl-bar"
                    data-open={end == null}
                    style={{ left: ((s - winStart) / DAY) * DAY_W, width, background: color }}
                    title={`${goal.title} · ${format(start, "MMM d, yyyy")}${
                      end ? ` – ${format(end, "MMM d, yyyy")}` : " – until done"
                    }`}
                  >
                    {width > 84 ? goal.title || "Untitled goal" : ""}
                  </div>
                  {started && (
                    <span className="tl-edge" style={{ left: 6 }}>
                      ⎯ {format(start, "MMM d")}
                    </span>
                  )}
                  {runsOn && (
                    <span className="tl-edge" style={{ right: 6 }}>
                      {end ? format(end, "MMM d") : "until done"} ⟶
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {goals.length > 0 && rows.length > 0 && (
            <div className="tl-section" style={{ width: NAME_W }}>
              Tasks
            </div>
          )}

          {rows.map((task) => {
            const color = resolveColor(task, projects);
            const overdue = isOverdue(task);
            const start = task.start ?? null;
            const due = task.dueAt ?? null;
            const earliest = start ?? due;
            const latest = task.end ?? earliest;
            const outsideLater = earliest != null && earliest >= winEnd;
            const outsideEarlier = latest != null && latest < winStart;

            let bar: { left: number; width: number } | null = null;
            if (start != null) {
              const s = Math.max(start, winStart);
              const e = Math.min(
                task.end ?? start + Math.max(15, task.estimateMin ?? 60) * 60_000,
                winEnd,
              );
              if (e > winStart && s < winEnd) {
                bar = {
                  left: ((s - winStart) / DAY) * DAY_W,
                  width: Math.max(8, ((e - s) / DAY) * DAY_W - 2),
                };
              }
            }

            const dueLeft =
              due != null && due >= winStart && due < winEnd
                ? ((due - winStart) / DAY) * DAY_W + DAY_W / 2
                : null;

            return (
              <div
                key={task.id}
                className="tl-row"
                data-done={isDone(task)}
                data-overdue={overdue}
                onClick={() => onOpen(task)}
                onContextMenu={(e) => openItemMenu(e, task)}
              >
                <div className="tl-name">
                  <span className="avatar-dot" style={{ background: color }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="tl-title">{task.title || "Untitled"}</div>
                    <div
                      className="tl-meta"
                      data-overdue={overdue}
                      title={
                        overdue
                          ? `Overdue · ${clockStamp(due!, timeFormat, "EEE, MMM d")}`
                          : undefined
                      }
                    >
                      {start != null
                        ? `${format(start, "MMM d")}, ${clockTime(start, timeFormat)}`
                        : due != null
                          ? `due ${format(due, "MMM d")}`
                          : "unscheduled"}
                    </div>
                    {overdue && (
                      <button
                        className="postpone-btn tl-postpone"
                        title="Change this task's due date"
                        onClick={(event) => openPostponeMenu(event, task.id)}
                      >
                        Postpone
                      </button>
                    )}
                  </div>
                </div>

                <div className="tl-track" style={{ width: trackWidth }}>
                  {trackCells}

                  {bar && (
                    <div
                      className="tl-bar"
                      style={{ left: bar.left, width: bar.width, background: color }}
                      title={`${task.title || "Untitled"} · ${format(Math.max(start!, winStart), "MMM d")}, ${clockTime(Math.max(start!, winStart), timeFormat)}${task.end ? ` – ${clockTime(task.end, timeFormat)}` : ""}`}
                    >
                      {bar.width > 84 ? task.title || "Untitled" : ""}
                    </div>
                  )}

                  {dueLeft != null && (
                    <span
                      className="tl-due"
                      data-overdue={overdue}
                      style={{ left: dueLeft, background: overdue ? undefined : color }}
                      title={`${overdue ? "Overdue · " : ""}Due ${format(due!, "EEEE, MMM d")} · ${clockTime(due!, timeFormat)}`}
                    />
                  )}

                  {outsideLater && (
                    <span className="tl-edge" style={{ right: 6 }}>
                      {format(earliest!, "MMM d")} →
                    </span>
                  )}
                  {outsideEarlier && (
                    <span className="tl-edge" style={{ left: 6 }}>
                      ← {format(latest!, "MMM d")}
                    </span>
                  )}

                  {start == null && due == null && (
                    <span className="tl-unscheduled-label">unscheduled</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
