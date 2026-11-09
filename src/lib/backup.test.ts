import { describe, expect, it } from "vitest";
import { BackupError, describeCounts, parseBackup } from "./backup";

const backup = {
  app: "tempo",
  version: 4,
  exportedAt: 1_700_000_000_000,
  items: [
    {
      id: "i_1",
      type: "task",
      title: "Read",
      workProjectId: "wp_1",
      createdAt: 1,
      updatedAt: 1,
    },
    { id: "i_2", type: "event", title: "Lecture", createdAt: 1, updatedAt: 1 },
  ],
  projects: [{ id: "p_1", name: "Study", color: "#4f46e5", order: 1 }],
  tags: [{ id: "t_1", name: "exam" }],
  focusSessions: [],
  goals: [
    {
      id: "g_1",
      title: "Read 20 books",
      span: "open",
      start: 1_690_000_000_000,
      end: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  schedules: [
    { id: "s_1", name: "Fall 2026", color: "#4f46e5", order: 0, from: 1, to: 2, createdAt: 1, updatedAt: 1 },
  ],
  scheduleItems: [
    { id: "si_1", scheduleId: "s_1", name: "BIO 201", days: [1, 3], startMin: 540, endMin: 615, order: 0 },
  ],
  scheduleBreaks: [
    { id: "sb_1", scheduleId: "s_1", label: "Reading week", from: 10, to: 14 },
  ],
  scheduleExceptions: [
    {
      id: "sx_1",
      scheduleId: "s_1",
      sessionId: "si_1",
      day: 12,
      kind: "edit" as const,
      title: "BIO 201 — Review",
      startMin: 600,
      endMin: 660,
      updatedAt: 2,
    },
  ],
  workProjects: [
    {
      id: "wp_1",
      name: "Thesis",
      description: "First draft",
      color: "#0d9488",
      calendarId: "p_1",
      start: 1,
      deadline: 2,
      workingDays: [1, 2, 3, 4, 5],
      memberIds: ["m_1"],
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  members: [{ id: "m_1", name: "Ada", color: "#4f46e5", role: "Writer", createdAt: 1, updatedAt: 1 }],
  taskDependencies: [] as {
    id: string;
    workProjectId: string;
    predecessorId: string;
    successorId: string;
    type: string;
    lagDays: number;
    createdAt: number;
  }[],
};

const link = {
  id: "d_1",
  workProjectId: "wp_1",
  predecessorId: "i_1",
  successorId: "i_3",
  type: "FS",
  lagDays: 0,
  createdAt: 1,
};

const projectItems = [
  ...backup.items,
  { id: "i_3", type: "task", title: "Draft", workProjectId: "wp_1", createdAt: 1, updatedAt: 1 },
];

describe("parseBackup", () => {
  it("accepts an exported file", () => {
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.items).toHaveLength(2);
    expect(parsed.projects[0].name).toBe("Study");
    expect(parsed.exportedAt).toBe(1_700_000_000_000);
    expect(parsed.goals).toHaveLength(1);
    expect(parsed.goals[0].span).toBe("open");
  });

  it("carries the weekly schedules, their breaks and one-off exceptions", () => {
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.schedules[0].name).toBe("Fall 2026");
    expect(parsed.scheduleItems[0].days).toEqual([1, 3]);
    expect(parsed.scheduleBreaks[0].label).toBe("Reading week");
    expect(parsed.scheduleExceptions[0].title).toBe("BIO 201 — Review");
  });

  it("carries work projects, members and dependency links", () => {
    const parsed = parseBackup(
      JSON.stringify({ ...backup, items: projectItems, taskDependencies: [link] }),
    );
    expect(parsed.workProjects[0].name).toBe("Thesis");
    expect(parsed.workProjects[0].memberIds).toEqual(["m_1"]);
    expect(parsed.members[0].name).toBe("Ada");
    expect(parsed.taskDependencies).toHaveLength(1);
    expect(parsed.taskDependencies[0].predecessorId).toBe("i_1");
  });

  it("still reads a version 1 file, which has no goals", () => {
    const parsed = parseBackup(
      JSON.stringify({ app: "tempo", version: 1, items: backup.items }),
    );
    expect(parsed.items).toHaveLength(2);
    expect(parsed.goals).toEqual([]);
  });

  it("still reads a version 2 file, which has no schedules", () => {
    const older: Record<string, unknown> = { ...backup, version: 2 };
    delete older.schedules;
    delete older.scheduleItems;
    delete older.scheduleBreaks;
    delete older.scheduleExceptions;
    const parsed = parseBackup(JSON.stringify(older));
    expect(parsed.schedules).toEqual([]);
    expect(parsed.scheduleItems).toEqual([]);
    expect(parsed.scheduleBreaks).toEqual([]);
    expect(parsed.scheduleExceptions).toEqual([]);
  });

  it("still reads a version 3 file, which has no work projects", () => {
    const older: Record<string, unknown> = { ...backup, version: 3 };
    delete older.workProjects;
    delete older.members;
    delete older.taskDependencies;
    const parsed = parseBackup(JSON.stringify(older));
    expect(parsed.workProjects).toEqual([]);
    expect(parsed.members).toEqual([]);
    expect(parsed.taskDependencies).toEqual([]);
  });

  it("tolerates missing optional collections", () => {
    const parsed = parseBackup(
      JSON.stringify({ app: "tempo", version: 2, items: backup.items }),
    );
    expect(parsed.projects).toEqual([]);
    expect(parsed.tags).toEqual([]);
    expect(parsed.focusSessions).toEqual([]);
    expect(parsed.goals).toEqual([]);
  });

  it("drops sessions, breaks and exceptions that name a schedule the file does not have", () => {
    const parsed = parseBackup(
      JSON.stringify({
        ...backup,
        scheduleItems: [
          ...backup.scheduleItems,
          { id: "si_2", scheduleId: "missing", name: "Orphan", days: [2], startMin: 0, endMin: 60 },
        ],
        scheduleBreaks: [
          { id: "sb_2", scheduleId: "missing", label: "Orphan", from: 1, to: 2 },
        ],
        scheduleExceptions: [
          ...backup.scheduleExceptions,
          { id: "sx_2", scheduleId: "missing", sessionId: "si_1", day: 12, kind: "delete", updatedAt: 2 },
          { id: "sx_3", scheduleId: "s_1", sessionId: "gone", day: 12, kind: "delete", updatedAt: 2 },
        ],
      }),
    );
    expect(parsed.scheduleItems.map((i) => i.id)).toEqual(["si_1"]);
    expect(parsed.scheduleBreaks).toEqual([]);
    expect(parsed.scheduleExceptions.map((row) => row.id)).toEqual(["sx_1"]);
  });

  it("drops links that point outside the file or across projects", () => {
    const otherProjectItem = {
      id: "i_4",
      type: "task",
      title: "Elsewhere",
      workProjectId: "wp_other",
      createdAt: 1,
      updatedAt: 1,
    };
    const parsed = parseBackup(
      JSON.stringify({
        ...backup,
        items: [...projectItems, otherProjectItem],
        taskDependencies: [
          link,
          { ...link, id: "d_2", successorId: "missing" },
          { ...link, id: "d_3", workProjectId: "wp_missing" },
          { ...link, id: "d_4", successorId: "i_4" },
        ],
      }),
    );
    expect(parsed.taskDependencies.map((d) => d.id)).toEqual(["d_1"]);
  });

  it("keeps one link per predecessor/successor pair", () => {
    const parsed = parseBackup(
      JSON.stringify({
        ...backup,
        items: projectItems,
        taskDependencies: [link, { ...link, id: "d_2" }],
      }),
    );
    expect(parsed.taskDependencies.map((d) => d.id)).toEqual(["d_1"]);
  });

  it("removes roster entries whose member is not in the file", () => {
    const parsed = parseBackup(
      JSON.stringify({
        ...backup,
        workProjects: [{ ...backup.workProjects[0], memberIds: ["m_1", "m_missing"] }],
      }),
    );
    expect(parsed.workProjects[0].memberIds).toEqual(["m_1"]);
  });

  it("rejects damaged schedules", () => {
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, schedules: [{ id: 3, name: "Fall" }] })),
    ).toThrow("schedules are damaged");
  });

  it("rejects damaged goals", () => {
    expect(() =>
      parseBackup(
        JSON.stringify({ ...backup, goals: [{ id: "g_1", title: "x", span: "decade", start: 1 }] }),
      ),
    ).toThrow("goals are damaged");
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, goals: [{ id: "g_1", title: "x", span: "month" }] })),
    ).toThrow(BackupError);
  });

  it("rejects damaged work projects, members and links", () => {
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, workProjects: [{ id: 3, name: "Thesis" }] })),
    ).toThrow("projects are damaged");
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, members: [{ id: "m_1" }] })),
    ).toThrow("members are damaged");
    expect(() =>
      parseBackup(
        JSON.stringify({
          ...backup,
          items: projectItems,
          taskDependencies: [{ ...link, type: "SS" }],
        }),
      ),
    ).toThrow("task links are damaged");
    expect(() =>
      parseBackup(
        JSON.stringify({
          ...backup,
          items: projectItems,
          taskDependencies: [{ ...link, lagDays: "2" }],
        }),
      ),
    ).toThrow("task links are damaged");
  });

  it("drops duplicate goal ids within one file", () => {
    const parsed = parseBackup(
      JSON.stringify({ ...backup, goals: [backup.goals[0], backup.goals[0]] }),
    );
    expect(parsed.goals.map((g) => g.id)).toEqual(["g_1"]);
  });

  it("rejects a file that is not JSON", () => {
    expect(() => parseBackup("not json")).toThrow(BackupError);
    expect(() => parseBackup("not json")).toThrow("valid JSON");
  });

  it("rejects JSON from another app", () => {
    expect(() => parseBackup(JSON.stringify({ app: "other", version: 1, items: [] }))).toThrow(
      "isn't a Tempo backup",
    );
  });

  it("rejects a backup from a newer version", () => {
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, version: 99 })),
    ).toThrow("newer version");
  });

  it("rejects damaged items", () => {
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, items: [{ id: 3, type: "task" }] })),
    ).toThrow("damaged");
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, items: [{ id: "x", type: "mystery" }] })),
    ).toThrow(BackupError);
  });

  it("drops duplicate ids within one file", () => {
    const parsed = parseBackup(
      JSON.stringify({ ...backup, items: [backup.items[0], backup.items[0], backup.items[1]] }),
    );
    expect(parsed.items.map((i) => i.id)).toEqual(["i_1", "i_2"]);
  });
});

describe("describeCounts", () => {
  it("lists only the collections that have something in them", () => {
    expect(
      describeCounts({
        items: 3,
        projects: 2,
        tags: 0,
        focusSessions: 1,
        goals: 0,
        schedules: 0,
        workProjects: 1,
        members: 2,
        habits: 3,
      }),
    ).toBe("3 items · 2 calendars · 1 project · 2 members · 3 habits · 1 focus session");
    expect(
      describeCounts({
        items: 3,
        projects: 0,
        tags: 0,
        focusSessions: 0,
        goals: 2,
        schedules: 1,
        workProjects: 0,
        members: 0,
        habits: 0,
      }),
    ).toBe("3 items · 2 goals · 1 schedule");
    expect(
      describeCounts({
        items: 1,
        projects: 0,
        tags: 0,
        focusSessions: 0,
        goals: 0,
        schedules: 0,
        workProjects: 0,
        members: 0,
        habits: 0,
      }),
    ).toBe("1 item");
  });
});
