import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckSquare,
  Command,
  CornerDownLeft,
  Flame,
  FolderKanban,
  LayoutGrid,
  ListTodo,
  Moon,
  Plus,
  Search,
  Settings,
  StickyNote,
  Sun,
  Target,
  Timer,
} from "lucide-react";
import { useGoals, useItems, useProjects } from "../../db/hooks";
import { draftFromGoal, isGoalDone } from "../../lib/goals";
import { useUI, PRESETS } from "../../store/ui";
import { useOpenView } from "../../store/nav";
import { createFromText } from "../../lib/create";
import { draftFromItem } from "../../lib/draft";
import { fuzzyFilter } from "../../lib/fuzzy";
import { eod, sod } from "../../lib/date";
import type { Goal, Item } from "../../types";

interface Result {
  id: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const setPaletteOpen = useUI((s) => s.setPaletteOpen);
  const openCreate = useUI((s) => s.openCreate);
  const openEdit = useUI((s) => s.openEdit);
  const setSettingsOpen = useUI((s) => s.setSettingsOpen);
  const applyPreset = useUI((s) => s.applyPreset);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const startTimer = useUI((s) => s.startTimer);
  const goToday = useUI((s) => s.goToday);
  const setSelectedWorkProject = useUI((s) => s.setSelectedWorkProject);
  const setProjectCreateOpen = useUI((s) => s.setProjectCreateOpen);
  const toast = useUI((s) => s.toast);
  const openView = useOpenView();

  const items = useItems();
  const goals = useGoals();
  const projects = useProjects();
  const openGoalCreate = useUI((s) => s.openGoalCreate);
  const openGoalEdit = useUI((s) => s.openGoalEdit);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const todayStart = sod(Date.now());

  const actions: Result[] = useMemo(
    () => [
      {
        id: "new-task",
        label: "New task",
        sub: "N",
        icon: <Plus size={13} />,
        run: () => openCreate({ type: "task", title: "", priority: 0 }),
      },
      {
        id: "new-event",
        label: "New event",
        sub: "E",
        icon: <CalendarDays size={13} />,
        run: () =>
          openCreate({
            type: "event",
            title: "",
            start: todayStart + 9 * 3_600_000,
            end: todayStart + 10 * 3_600_000,
          }),
      },
      {
        id: "new-project",
        label: "New project",
        icon: <FolderKanban size={13} />,
        run: () => {
          setSelectedWorkProject(null);
          setProjectCreateOpen(true);
          openView("projects");
        },
      },
      {
        id: "new-goal",
        label: "New goal",
        sub: "G",
        icon: <Target size={13} />,
        run: () => openGoalCreate({ span: "month" }),
      },
      {
        id: "new-note",
        label: "New note",
        icon: <StickyNote size={13} />,
        run: () => openCreate({ type: "note", title: "", body: "" }),
      },
      {
        id: "go-today",
        label: "Go to Today",
        sub: "T",
        icon: <Sun size={13} />,
        run: () => openView("today"),
      },
      {
        id: "go-calendar",
        label: "Go to Calendar",
        icon: <CalendarDays size={13} />,
        run: () => openView("calendar"),
      },
      {
        id: "go-tasks",
        label: "Go to Tasks",
        icon: <ListTodo size={13} />,
        run: () => openView("tasks"),
      },
      {
        id: "go-habits",
        label: "Go to Habits",
        icon: <Flame size={13} />,
        run: () => openView("habits"),
      },
      {
        id: "go-projects",
        label: "Go to Projects",
        icon: <FolderKanban size={13} />,
        run: () => {
          setSelectedWorkProject(null);
          openView("projects");
        },
      },
      {
        id: "go-goals",
        label: "Go to Goals",
        icon: <Target size={13} />,
        run: () => openView("goals"),
      },
      {
        id: "go-focus",
        label: "Go to Focus",
        icon: <Timer size={13} />,
        run: () => openView("focus"),
      },
      {
        id: "jump-today",
        label: "Jump calendar to today",
        icon: <CalendarDays size={13} />,
        run: goToday,
      },
      ...PRESETS.map((preset) => ({
        id: `layout-${preset.id}`,
        label: `Layout: ${preset.label}`,
        icon: <LayoutGrid size={13} />,
        run: () => applyPreset(preset.id),
      })),
      {
        id: "focus-25",
        label: "Start a 25 minute focus session",
        icon: <Timer size={13} />,
        run: () => startTimer(25, "focus", null),
      },
      {
        id: "theme",
        label: "Cycle appearance",
        icon: <Moon size={13} />,
        run: toggleTheme,
      },
      {
        id: "settings",
        label: "Settings",
        icon: <Settings size={13} />,
        run: () => setSettingsOpen(true),
      },
    ],
    [
      openCreate,
      openView,
      openGoalCreate,
      goToday,
      applyPreset,
      startTimer,
      toggleTheme,
      setSettingsOpen,
      setSelectedWorkProject,
      setProjectCreateOpen,
      todayStart,
    ],
  );

  /** Goals answer the same search as items; they just open their own sheet. */
  const goalResults: Result[] = useMemo(() => {
    const live = goals.filter((g) => !g.deletedAt);
    const matches = query.trim()
      ? fuzzyFilter(query, live, (g) => g.title).slice(0, 5)
      : live.filter((g) => !isGoalDone(g)).slice(0, 3);
    return matches.map((goal: Goal) => ({
      id: goal.id,
      label: goal.title || "Untitled goal",
      sub: ["goal", isGoalDone(goal) ? "done" : goal.span].join(" · "),
      icon: <Target size={13} />,
      run: () => openGoalEdit(goal.id, draftFromGoal(goal)),
    }));
  }, [goals, query, openGoalEdit]);

  const itemResults: Result[] = useMemo(() => {
    const live = items.filter((i) => !i.deletedAt);
    const matches = query.trim()
      ? fuzzyFilter(query, live, (i) => `${i.title} ${i.location ?? ""}`).slice(0, 7)
      : live
          .filter((i) => i.start != null && i.start >= todayStart && i.start <= eod(todayStart))
          .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
          .slice(0, 5);

    return matches.map((item: Item) => ({
      id: item.id,
      label: item.title || "Untitled",
      sub: [item.type, projects.find((p) => p.id === item.projectId)?.name]
        .filter(Boolean)
        .join(" · "),
      icon:
        item.type === "task" ? (
          <CheckSquare size={13} />
        ) : item.type === "note" ? (
          <StickyNote size={13} />
        ) : (
          <CalendarDays size={13} />
        ),
      run: () => openEdit(item.id, draftFromItem(item)),
    }));
  }, [items, query, projects, openEdit, todayStart]);

  const createResult: Result | null = query.trim()
    ? {
        id: "create",
        label: `Add “${query.trim()}”`,
        sub: "natural language",
        icon: <Plus size={13} />,
        run: async () => {
          const created = await createFromText(query, projects);
          if (created) {
            toast(created.type === "event" ? "Event added" : "Task added");
            openEdit(created.id, draftFromItem(created));
          }
        },
      }
    : null;

  const commandMatches = fuzzyFilter(query, actions, (a) => a.label + " " + (a.sub ?? ""));

  const results = useMemo(() => {
    const list: Result[] = [];
    if (createResult) list.push(createResult);
    list.push(...commandMatches.slice(0, query ? 5 : 8));
    if (itemResults.length) list.push(...itemResults);
    if (goalResults.length) list.push(...goalResults);
    return list;
  }, [createResult, commandMatches, itemResults, goalResults, query]);

  useEffect(() => setIndex(0), [query]);

  const runResult = async (result: Result | undefined) => {
    if (!result) return;
    setPaletteOpen(false);
    await result.run();
  };

  let flatIndex = 0;
  const renderGroup = (title: string, group: Result[]) => {
    if (group.length === 0) return null;
    return (
      <div key={title}>
        <div className="palette-section">{title}</div>
        {group.map((result) => {
          const active = flatIndex === index;
          const myIndex = flatIndex++;
          return (
            <button
              key={result.id}
              className="palette-item"
              data-active={active}
              onMouseEnter={() => setIndex(myIndex)}
              onClick={() => void runResult(result)}
            >
              {result.icon}
              <span className="truncate">{result.label}</span>
              {result.sub && <span className="palette-sub">{result.sub}</span>}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setPaletteOpen(false);
      }}
    >
      <div className="palette">
        <div className="palette-input">
          <Search size={15} style={{ color: "var(--text-3)" }} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search or type a command…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                void runResult(results[index]);
              } else if (e.key === "Escape") {
                setPaletteOpen(false);
              }
            }}
          />
          <span className="kbd">
            <Command size={9} style={{ verticalAlign: "-1px" }} /> K
          </span>
        </div>
        <div className="palette-list">
          {results.length === 0 && (
            <div className="empty">
              <strong>No matches</strong>
              Try a different word, or press Enter to create an item.
            </div>
          )}
          {renderGroup(
            createResult ? "Quick create" : "Quick actions",
            results.filter((r) => r.id === "create"),
          )}
          {renderGroup(
            query ? "Commands" : "Commands",
            commandMatches.slice(0, query ? 5 : 8),
          )}
          {renderGroup("Items", itemResults)}
          {renderGroup("Goals", goalResults)}
        </div>
        <div className="palette-foot">
          <span className="row" style={{ gap: 4 }}>
            <CornerDownLeft size={10} /> open
          </span>
          <span>↑↓ navigate</span>
          <span>esc close</span>
          <span className="spacer" />
          <span>{results.length} results</span>
        </div>
      </div>
    </div>
  );
}
