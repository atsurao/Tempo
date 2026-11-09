import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, CornerDownLeft, Target, Trash2, X } from "lucide-react";
import type { Goal, GoalSpan } from "../../types";
import { useGoals, useProjects } from "../../db/hooks";
import { useUI } from "../../store/ui";
import { createGoal, restoreGoal, setGoalDone, softDeleteGoal } from "../../db/db";
import {
  draftFromGoal,
  GOAL_SPANS,
  goalDateLabel,
  goalElapsed,
  goalTimeLabel,
  groupBySpan,
  isGoalDone,
  resolveGoalColor,
  sortGoals,
  spanLabel,
} from "../../lib/goals";
import { sod } from "../../lib/date";

/**
 * Long-term goals: separate from tasks and events, but drawn on the calendar
 * and in the task timeline so the horizon stays visible while planning a day.
 */
export function GoalsPane() {
  const goals = useGoals();
  const projects = useProjects();
  const filterProjectId = useUI((s) => s.filterProjectId);
  const setFilterProject = useUI((s) => s.setFilterProject);
  const openGoalEdit = useUI((s) => s.openGoalEdit);
  const toast = useUI((s) => s.toast);

  const [title, setTitle] = useState("");
  const [span, setSpan] = useState<GoalSpan>("month");
  const [showDone, setShowDone] = useState(true);
  const [busy, setBusy] = useState(false);

  const live = useMemo(() => goals.filter((g) => !g.deletedAt), [goals]);
  const scoped = useMemo(
    () => (filterProjectId ? live.filter((g) => g.projectId === filterProjectId) : live),
    [live, filterProjectId],
  );
  const groups = useMemo(() => groupBySpan(scoped), [scoped]);
  const completed = useMemo(() => sortGoals(scoped.filter(isGoalDone)), [scoped]);
  const activeCount = scoped.length - completed.length;

  const add = async (openEditor: boolean) => {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const goal = await createGoal({
        title: name,
        span,
        start: sod(Date.now()),
        projectId: filterProjectId,
      });
      setTitle("");
      if (openEditor) openGoalEdit(goal.id, draftFromGoal(goal));
      else toast(`${spanLabel(span)} goal added`, { tone: "success" });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (goal: Goal) => {
    const done = isGoalDone(goal);
    await setGoalDone(goal.id, !done);
    if (!done) {
      toast(`Completed “${goal.title}”`, {
        actionLabel: "Undo",
        action: () => void setGoalDone(goal.id, false),
      });
    }
  };

  const remove = async (goal: Goal) => {
    await softDeleteGoal(goal.id);
    toast(`Deleted “${goal.title}”`, {
      actionLabel: "Undo",
      action: () => void restoreGoal(goal.id),
    });
  };

  const row = (goal: Goal, done: boolean) => {
    const color = resolveGoalColor(goal, projects);
    const project = projects.find((p) => p.id === goal.projectId);
    const elapsed = goalElapsed(goal);
    return (
      <div
        key={goal.id}
        className="goal-row"
        data-done={done}
        role="button"
        tabIndex={0}
        onClick={() => openGoalEdit(goal.id, draftFromGoal(goal))}
        onKeyDown={(e) => {
          if (e.key === "Enter") openGoalEdit(goal.id, draftFromGoal(goal));
        }}
      >
        <button
          className="check"
          data-checked={done}
          style={{ width: 15, height: 15 }}
          title={done ? "Reopen this goal" : "Mark this goal done"}
          onClick={(e) => {
            e.stopPropagation();
            void toggle(goal);
          }}
        >
          <Check size={10} strokeWidth={3} />
        </button>

        <span className="goal-dot" style={{ background: color }} />

        <div className="goal-main">
          <div className="goal-title">{goal.title}</div>
          <div className="goal-meta">
            <span>{goalDateLabel(goal)}</span>
            <span className="goal-sep">·</span>
            <span>{goalTimeLabel(goal)}</span>
            {project && (
              <>
                <span className="goal-sep">·</span>
                <span className="row" style={{ gap: 4 }}>
                  <span className="project-dot" style={{ background: project.color }} />
                  {project.name}
                </span>
              </>
            )}
            {done && (
              <>
                <span className="goal-sep">·</span>
                <span>{spanLabel(goal.span)}</span>
              </>
            )}
          </div>
          {elapsed != null && !done && (
            <div className="goal-progress" title={`${Math.round(elapsed * 100)}% of the horizon`}>
              <span style={{ width: `${Math.round(elapsed * 100)}%`, background: color }} />
            </div>
          )}
        </div>

        <button
          className="icon-btn goal-delete"
          title={`Delete “${goal.title}”`}
          onClick={(e) => {
            e.stopPropagation();
            void remove(goal);
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    );
  };

  return (
    <div className="goals">
      <div className="goal-add">
        <div className="goal-add-row">
          <Target size={13} style={{ color: "var(--text-3)", flex: "none" }} />
          <input
            value={title}
            placeholder="Add a goal…  run a half marathon by spring"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add(e.metaKey || e.ctrlKey);
              }
            }}
          />
          {title.trim() && (
            <button className="btn icon sm" title="Add (Enter)" onClick={() => void add(false)}>
              <CornerDownLeft size={12} />
            </button>
          )}
        </div>
        <div className="goal-add-spans">
          {GOAL_SPANS.map((option) => (
            <button
              key={option.id}
              className="filter-chip"
              data-active={span === option.id}
              title={option.hint}
              onClick={() => setSpan(option.id)}
            >
              {option.label}
            </button>
          ))}
          <span className="spacer" />
          <span className="faint goal-add-hint">{GOAL_SPANS.find((s) => s.id === span)?.hint}</span>
        </div>
      </div>

      {filterProjectId && (
        <div className="tasks-toolbar">
          <button className="filter-chip" onClick={() => setFilterProject(null)} title="Clear calendar filter">
            <span className="row" style={{ gap: 4 }}>
              <X size={10} /> {projects.find((p) => p.id === filterProjectId)?.name ?? "calendar"}
            </span>
          </button>
        </div>
      )}

      <div className="goals-scroll">
        {scoped.length === 0 && (
          <div className="empty">
            <strong>No goals yet</strong>
            Goals are the long arc: a month-long push, a year-long ambition, or something with no
            end date at all. Add one above and it shows up on the calendar and in the tasks
            timeline.
          </div>
        )}

        {groups.map((group) => (
          <div className="goal-group" key={group.span}>
            <div className="section-title" style={{ marginTop: 14 }}>
              {spanLabel(group.span)}
              <span className="count">{group.goals.length}</span>
            </div>
            {group.goals.map((goal) => row(goal, false))}
          </div>
        ))}

        {completed.length > 0 && (
          <div className="goal-group">
            <button
              className="section-title goal-done-toggle"
              onClick={() => setShowDone((v) => !v)}
              title={showDone ? "Hide completed goals" : "Show completed goals"}
            >
              {showDone ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Completed
              <span className="count">{completed.length}</span>
            </button>
            {showDone && completed.map((goal) => row(goal, true))}
          </div>
        )}

        {activeCount > 0 && (
          <div className="goals-note">
            {activeCount} active {activeCount === 1 ? "goal" : "goals"} · also drawn on the calendar
            and in the tasks timeline
          </div>
        )}
      </div>
    </div>
  );
}
