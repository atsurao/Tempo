import { useMemo, useState } from "react";
import { Archive, Check, Flame, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Habit } from "../../types";
import { PALETTE } from "../../types";
import {
  useHabitCheckins,
  useHabits,
  useNow,
} from "../../db/hooks";
import { createHabit, deleteHabit, toggleHabitDone, updateHabit } from "../../db/db";
import {
  doneDays,
  EVERY_DAY,
  habitCompletion,
  habitStreak,
  habitSummary,
  habitsDueOn,
  isHabitDone,
  recentDays,
} from "../../lib/habits";
import { DAY, sod } from "../../lib/date";
import { WEEKDAY_INITIALS } from "../../lib/schedule";
import { useUI } from "../../store/ui";

type Filter = "today" | "all";

/**
 * Habits are not tasks: they are never finished, only done on a day. This pane
 * is built around that — a yes/no for today, the week behind it, and a streak
 * that survives the morning it has not been ticked yet.
 */
export function HabitsPane() {
  const habits = useHabits();
  const checkins = useHabitCheckins();
  const now = useNow(60_000);
  const today = sod(now);
  const weekStart = useUI((s) => s.weekStart);
  const toast = useUI((s) => s.toast);

  const [filter, setFilter] = useState<Filter>("today");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const done = useMemo(() => doneDays(checkins), [checkins]);
  const active = useMemo(
    () => habits.filter((habit) => !habit.archivedAt),
    [habits],
  );
  const archived = useMemo(
    () => habits.filter((habit) => habit.archivedAt),
    [habits],
  );
  const dueToday = useMemo(() => habitsDueOn(active, today), [active, today]);
  const rows = filter === "today" ? dueToday : active;
  const doneToday = dueToday.filter((habit) => isHabitDone(done, habit.id, today)).length;

  const add = async () => {
    const title = name.trim();
    if (!title) {
      setAdding(false);
      return;
    }
    const habit = await createHabit({
      name: title,
      days: [...EVERY_DAY],
      start: today,
      color: PALETTE[habits.length % PALETTE.length],
    });
    setName("");
    setEditingId(habit.id);
    toast(`“${habit.name}” added`);
  };

  const toggle = async (habit: Habit, day = today) => {
    const nowDone = await toggleHabitDone(habit, day);
    if (day === today && nowDone) {
      const streak = habitStreak(habit, done, now) + 1;
      if (streak > 1) toast(`${habit.name} · ${streak} in a row`, { tone: "success" });
    }
  };

  return (
    <div className="habits">
      <div className="habits-head">
        <div className="habits-headline">
          <Flame size={14} />
          <span>
            {doneToday}/{dueToday.length} today
          </span>
        </div>
        <div className="seg">
          <button data-active={filter === "today"} onClick={() => setFilter("today")}>
            Today
          </button>
          <button data-active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </button>
        </div>
      </div>

      {adding ? (
        <div className="habit-add">
          <input
            autoFocus
            className="input"
            placeholder="Walk, read, practise…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
              if (e.key === "Escape") {
                setAdding(false);
                setName("");
              }
            }}
            onBlur={() => {
              if (!name.trim()) setAdding(false);
            }}
          />
          <button className="btn sm primary" onClick={() => void add()} disabled={!name.trim()}>
            Add
          </button>
        </div>
      ) : (
        <button className="habit-new" onClick={() => setAdding(true)}>
          <Plus size={12} /> New habit
        </button>
      )}

      {rows.length === 0 && (
        <div className="empty habits-empty">
          <strong>{filter === "today" ? "Nothing due today" : "No habits yet"}</strong>
          {filter === "today"
            ? "Your other habits are resting until their next day."
            : "A habit is something you do again and again, and never finish."}
        </div>
      )}

      <div className="habits-list">
        {rows.map((habit) => {
          const week = recentDays(habit, done, 7, now);
          const streak = habitStreak(habit, done, now);
          const hits = isHabitDone(done, habit.id, today);
          const open = editingId === habit.id;
          const completion = habitCompletion(habit, done, 30, now);
          return (
            <div className="habit" key={habit.id} data-open={open}>
              <div className="habit-row" data-done={hits}>
                <button
                  className="check habit-check"
                  data-checked={hits}
                  onClick={() => void toggle(habit)}
                  title={hits ? "Undo today" : "Mark done today"}
                  aria-label={hits ? `Undo ${habit.name} today` : `Mark ${habit.name} done today`}
                >
                  <Check size={10} strokeWidth={3.2} />
                </button>
                <button className="habit-main" onClick={() => setEditingId(open ? null : habit.id)}>
                  <span className="habit-title-line">
                    <span className="project-dot" style={{ background: habit.color }} />
                    <span className="habit-title">{habit.name}</span>
                  </span>
                  <span className="habit-meta">
                    {habitSummary(habit)}
                    {streak > 0 && (
                      <span className="habit-streak">
                        <Flame size={9} /> {streak}
                      </span>
                    )}
                    {filter === "all" && <span className="faint">{completion.pct}% in 30 days</span>}
                  </span>
                </button>
                <div className="habit-week" aria-label="Last seven days">
                  {week.map((day) => (
                    <button
                      key={day.day}
                      className="habit-day"
                      data-due={day.due}
                      data-done={day.done}
                      data-today={day.day === today}
                      disabled={!day.due}
                      title={
                        day.due
                          ? `${new Date(day.day).toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}${day.done ? " · done" : ""}`
                          : "Not scheduled"
                      }
                      onClick={() => void toggle(habit, day.day)}
                    />
                  ))}
                </div>
              </div>

              {open && (
                <div className="habit-editor">
                  <input
                    className="input habit-name-input"
                    value={habit.name}
                    aria-label="Habit name"
                    onChange={(e) => void updateHabit(habit.id, { name: e.target.value })}
                  />
                  <div className="habit-days">
                    {Array.from({ length: 7 }, (_, i) => (i + weekStart) % 7).map((day) => {
                      const on = habit.days.includes(day);
                      return (
                        <button
                          key={day}
                          data-active={on}
                          title={new Date(2024, 0, 7 + day).toLocaleDateString(undefined, {
                            weekday: "long",
                          })}
                          onClick={() =>
                            void updateHabit(habit.id, {
                              days: on
                                ? habit.days.filter((d) => d !== day)
                                : [...habit.days, day],
                            })
                          }
                        >
                          {WEEKDAY_INITIALS[day]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="habit-editor-row">
                    <label className="habit-interval">
                      <span>Every</span>
                      <select
                        value={habit.interval}
                        aria-label="Repeat interval"
                        onChange={(e) =>
                          void updateHabit(habit.id, { interval: Number(e.target.value) })
                        }
                      >
                        {[1, 2, 3, 4].map((n) => (
                          <option key={n} value={n}>
                            {n} {n === 1 ? "week" : "weeks"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="spacer" />
                    <button
                      className="icon-btn"
                      title={habit.archivedAt ? "Restore habit" : "Archive habit"}
                      onClick={() =>
                        void updateHabit(habit.id, { archivedAt: habit.archivedAt ? null : Date.now() })
                      }
                    >
                      {habit.archivedAt ? <RotateCcw size={12} /> : <Archive size={12} />}
                    </button>
                    <button
                      className="icon-btn"
                      title="Delete habit and its history"
                      onClick={() => {
                        void deleteHabit(habit.id);
                        setEditingId(null);
                        toast(`Deleted “${habit.name}”`);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="faint habit-hint">
                    Habits repeat forever; archive one to keep its history without it on the list.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filter === "all" && archived.length > 0 && (
        <>
          <div className="section-title">Archived</div>
          {archived.map((habit) => (
            <div className="habit habit-archived" key={habit.id}>
              <div className="habit-row">
                <span className="project-dot" style={{ background: habit.color }} />
                <span className="habit-title">{habit.name}</span>
                <span className="spacer" />
                <button
                  className="btn sm"
                  onClick={() => void updateHabit(habit.id, { archivedAt: null })}
                >
                  Restore
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {filter === "all" && habits.length > 0 && (
        <div className="faint habits-foot">
          {habits.length} habit{habits.length === 1 ? "" : "s"} ·{" "}
          {checkins.filter((c) => c.day >= today - 29 * DAY).length} check-ins this month
        </div>
      )}
    </div>
  );
}
