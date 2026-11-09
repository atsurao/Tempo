import { useEffect, useMemo, useRef, useState } from "react";
import { clockTime } from "../../lib/clock";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import { Coffee, Pause, Play, RotateCcw, Timer } from "lucide-react";
import { useFocusSessions, useItems, useNow } from "../../db/hooks";
import { useUI } from "../../store/ui";
import { logFocusSession } from "../../db/db";
import { isDone } from "../../lib/tasks";
import { sod } from "../../lib/date";
import { sendSystemNotification } from "../../lib/notify";
import { Select } from "../ui/Select";

const PRESETS = [
  { label: "25 / 5", focus: 25, break: 5 },
  { label: "50 / 10", focus: 50, break: 10 },
  { label: "15 / 3", focus: 15, break: 3 },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function FocusPane() {
  const timer = useUI((s) => s.timer);
  const startTimer = useUI((s) => s.startTimer);
  const pauseTimer = useUI((s) => s.pauseTimer);
  const resumeTimer = useUI((s) => s.resumeTimer);
  const resetTimer = useUI((s) => s.resetTimer);
  const setTimerTask = useUI((s) => s.setTimerTask);
  const toast = useUI((s) => s.toast);

  const items = useItems();
  const sessions = useFocusSessions();
  const timeFormat = useTimeFormat();
  const now = useNow(1000);
  const [preset, setPreset] = useState(0);
  const completedRef = useRef(false);

  const remaining = timer.running && timer.endsAt ? Math.max(0, Math.round((timer.endsAt - now) / 1000)) : timer.remainingSec;
  const progress = timer.totalSec > 0 ? 1 - remaining / timer.totalSec : 0;
  const task = items.find((i) => i.id === timer.taskId);
  const openTasks = useMemo(
    () => items.filter((i) => i.type === "task" && !i.deletedAt && !isDone(i)).slice(0, 40),
    [items],
  );

  const todaySessions = useMemo(
    () => sessions.filter((s) => s.startedAt >= sod(now)),
    [sessions, now],
  );
  const todayMinutes = Math.round(
    todaySessions.reduce((sum, s) => sum + Math.max(s.plannedMin, 1), 0),
  );

  useEffect(() => {
    if (!timer.running || timer.endsAt == null) {
      completedRef.current = false;
      return;
    }
    if (now < timer.endsAt || completedRef.current) return;
    completedRef.current = true;
    void logFocusSession({
      startedAt: timer.startedAt ?? now - timer.totalSec * 1000,
      endedAt: now,
      plannedMin: Math.round(timer.totalSec / 60),
      taskId: timer.taskId,
      label: task?.title,
    });
    resetTimer();
    const message = timer.mode === "focus" ? "Focus session complete. Take a break." : "Break over — back to it.";
    toast(message);
    sendSystemNotification("Tempo", message);
  }, [now, timer, task, resetTimer, toast]);

  const radius = 66;
  const circumference = 2 * Math.PI * radius;

  const start = () => {
    const p = PRESETS[preset];
    startTimer(timer.mode === "focus" ? p.focus : p.break, timer.mode, timer.taskId);
  };

  return (
    <div className="focus">
      <div className="timer-card">
        <div className="timer-ring">
          <svg viewBox="0 0 150 150">
            <circle cx="75" cy="75" r={radius} fill="none" stroke="var(--border)" strokeWidth="3" />
            <circle
              cx="75"
              cy="75"
              r={radius}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              style={{ transition: "stroke-dashoffset 400ms linear" }}
            />
          </svg>
          <div className="center" style={{ flexDirection: "column" }}>
            <div className="timer-time">
              {pad(Math.floor(remaining / 60))}:{pad(remaining % 60)}
            </div>
            <div className="timer-mode">
              {timer.mode === "focus" ? (remaining === timer.totalSec ? "ready" : "focus") : "break"}
            </div>
          </div>
        </div>

        <div className="timer-controls">
          <button className="btn icon" onClick={resetTimer} title="Reset">
            <RotateCcw size={14} />
          </button>
          {timer.running ? (
            <button className="btn primary" onClick={pauseTimer}>
              <Pause size={13} /> Pause
            </button>
          ) : (
            <button className="btn primary" onClick={timer.remainingSec < timer.totalSec ? resumeTimer : start}>
              <Play size={13} /> {timer.remainingSec < timer.totalSec ? "Resume" : "Start"}
            </button>
          )}
          <button
            className="btn icon"
            title={timer.mode === "focus" ? "Switch to break" : "Switch to focus"}
            onClick={() => {
              const nextMode = timer.mode === "focus" ? "break" : "focus";
              const p = PRESETS[preset];
              startTimer(nextMode === "focus" ? p.focus : p.break, nextMode, timer.taskId);
            }}
          >
            {timer.mode === "focus" ? <Coffee size={14} /> : <Timer size={14} />}
          </button>
        </div>

        <div className="focus-presets">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              className="focus-preset"
              data-active={preset === i}
              onClick={() => {
                setPreset(i);
                if (!timer.running) {
                  resetTimer();
                  useUI.setState({
                    timer: {
                      ...useUI.getState().timer,
                      remainingSec: p.focus * 60,
                      totalSec: p.focus * 60,
                    },
                  });
                }
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="focus-task">
          <Timer size={11} />
          <Select
            value={timer.taskId ?? ""}
            ariaLabel="Task to focus on"
            options={[
              { value: "", label: "No task attached" },
              ...openTasks.map((t) => ({ value: t.id, label: t.title })),
            ]}
            onChange={(v) => setTimerTask(v || null)}
          />
        </div>
      </div>

      <div>
        <div className="section-title" style={{ marginTop: 0 }}>
          <Timer size={11} /> Focused today
        </div>
        <div className="focus-total">
          <span className="big">{todayMinutes}</span>
          <span className="faint">minutes · {todaySessions.length} sessions</span>
        </div>
        <div className="week-progress">
          <span style={{ width: `${Math.min(100, (todayMinutes / 120) * 100)}%` }} />
        </div>
        <div className="faint" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
          Goal: 2 hours of deep work
        </div>
      </div>

      <div>
        <div className="section-title" style={{ marginTop: 0 }}>
          Session log
        </div>
        <div className="focus-sessions">
          {todaySessions.length === 0 && (
            <div className="today-empty">No sessions yet today. Start the timer.</div>
          )}
          {todaySessions.map((session) => {
            const label = items.find((i) => i.id === session.taskId)?.title ?? session.label ?? "Focus";
            return (
              <div className="session-row" key={session.id}>
                <span className="session-time">{clockTime(session.startedAt, timeFormat)}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {label}
                </span>
                <span className="faint">{session.plannedMin}m</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
