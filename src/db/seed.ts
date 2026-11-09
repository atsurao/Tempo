import { addDays, setHours, setMinutes, startOfDay, startOfMonth, startOfWeek, startOfYear } from "date-fns";
import type {
  Goal,
  GoalSpan,
  Habit,
  HabitCheckin,
  Item,
  Project,
  Schedule,
  ScheduleItem,
  Tag,
} from "../types";
import { db, getSetting, setSetting } from "./db";
import { bypassCurrentSyncTransaction } from "../lib/sync/writeGuard";
import { uid } from "../lib/id";
import { goalEnd } from "../lib/goals";
import { checkinId } from "../lib/habits";

function at(base: Date, dayOffset: number, hour: number, minute = 0): number {
  const day = addDays(startOfDay(base), dayOffset);
  return setMinutes(setHours(day, hour), minute).getTime();
}

let seedPromise: Promise<void> | null = null;

/** Guard against StrictMode's double effect invocation. */
export function seedOnce(): Promise<void> {
  if (!seedPromise) seedPromise = seedIfEmpty();
  return seedPromise;
}

/**
 * Only one window may fill an empty database. The claim is written inside a
 * single settings transaction, so a second launch — StrictMode's double
 * effect, another window, or a reload while the first seed is still running —
 * backs off instead of adding a second copy of every sample calendar and task.
 * A claim left behind by a crash goes stale, and the next launch seeds.
 */
const SEED_CLAIM = "seed-claim";
const SEED_CLAIM_MS = 30_000;

async function claimSeed(): Promise<boolean> {
  return db.transaction("rw", db.settings, async () => {
    const [seeded, claim] = await Promise.all([
      db.settings.get("seeded"),
      db.settings.get(SEED_CLAIM),
    ]);
    if (seeded?.value) return false;
    const at = typeof claim?.value === "number" ? claim.value : 0;
    if (at > 0 && Date.now() - at < SEED_CLAIM_MS) return false;
    await db.settings.put({ key: SEED_CLAIM, value: Date.now() });
    return true;
  });
}

export async function seedIfEmpty(): Promise<void> {
  if (!(await claimSeed())) return;
  try {
    await seedSampleWorkspace();
  } finally {
    await db.settings.delete(SEED_CLAIM);
  }
}

async function seedSampleWorkspace(): Promise<void> {
  // A device that is joining an existing workspace must not seed demo data.
  if ((await db.syncDevice.get("local"))?.enabled) return;
  // Seeding runs before sync exists and writes dozens of rows at once, so it
  // is an explicit whole-workspace bypass rather than dozens of journal batches.
  await db.transaction("rw", db.tables, async () => {
    bypassCurrentSyncTransaction();
    await seedSampleWorkspaceInTransaction();
  });
}

async function seedSampleWorkspaceInTransaction(): Promise<void> {
  if ((await db.syncDevice.get("local"))?.enabled) return;
  if (await getSetting("seeded", false)) return;
  const count = await db.items.count();
  if (count > 0) {
    await setSetting("seeded", true);
    return;
  }

  const now = Date.now();
  const monday = startOfWeek(now, { weekStartsOn: 1 });
  const today = startOfDay(now);
  const todayIdx = Math.round((today.getTime() - monday.getTime()) / 86_400_000);

  const school: Project = { id: uid("p"), name: "School", color: "#4f46e5", order: 0 };
  const personal: Project = { id: uid("p"), name: "Personal", color: "#0d9488", order: 1 };
  const career: Project = { id: uid("p"), name: "Career", color: "#d97706", order: 2 };
  await db.projects.bulkAdd([school, personal, career]);

  const tags: Tag[] = [
    { id: uid("t"), name: "assignment" },
    { id: uid("t"), name: "reading" },
    { id: uid("t"), name: "exam" },
    { id: uid("t"), name: "lab" },
    { id: uid("t"), name: "health" },
  ];
  await db.tags.bulkAdd(tags);
  const tag = (name: string) => tags.find((t) => t.name === name)!.id;

  const stamp = (extra: Partial<Item> & { type: Item["type"]; title: string }): Item => ({
    id: uid(),
    createdAt: now,
    updatedAt: now,
    tagIds: [],
    reminders: [],
    ...extra,
  });

  const items: Item[] = [];

  // ---- the term: classes live in a weekly schedule rather than as one
  // recurring event each, so the whole timetable is edited in one place.
  const termStart = startOfDay(monday);
  const termWeeks = 14;
  const term: Schedule = {
    id: uid("s"),
    name: "Fall 2026",
    color: "#0284c7",
    order: 0,
    from: termStart.getTime(),
    to: addDays(termStart, termWeeks * 7 - 1).getTime(),
    createdAt: now,
    updatedAt: now,
  };
  await db.schedules.add(term);

  const slot = (
    name: string,
    days: number[],
    startH: number,
    startM: number,
    endH: number,
    endM: number,
    location: string,
    order: number,
  ): ScheduleItem => ({
    id: uid("si"),
    scheduleId: term.id,
    name,
    days,
    startMin: startH * 60 + startM,
    endMin: endH * 60 + endM,
    location,
    order,
  });
  await db.scheduleItems.bulkAdd([
    slot("BIO 201 — Lecture", [1, 3, 5], 9, 0, 10, 15, "Science Hall 2B", 0),
    slot("Calculus II", [2, 4], 11, 0, 12, 30, "Math 104", 1),
    slot("Organic Chem Lab", [3], 14, 0, 17, 0, "Lab 3-118", 2),
    slot("Study group", [4], 16, 0, 17, 30, "Library, 3rd floor", 3),
    slot("Office hours — Prof. Lin", [5], 13, 0, 14, 0, "Science Hall 3.204", 4),
  ]);

  // Two breaks in the term, so the list of them has something in it.
  const termDay = (n: number) => addDays(termStart, n).getTime();
  await db.scheduleBreaks.bulkAdd([
    { id: uid("sb"), scheduleId: term.id, label: "Reading week", from: termDay(35), to: termDay(39) },
    { id: uid("sb"), scheduleId: term.id, label: "Thanksgiving break", from: termDay(52), to: termDay(53) },
  ]);

  // ---- weekly events outside the timetable
  items.push(
    stamp({
      type: "event",
      title: "Gym",
      start: at(monday, 0, 7),
      end: at(monday, 0, 8),
      projectId: personal.id,
      recurrence: { rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" },
      tagIds: [tag("health")],
    }),
  );

  // ---- one-off events
  items.push(
    stamp({
      type: "event",
      title: "Coffee with Maya",
      start: at(monday, todayIdx + 1, 10),
      end: at(monday, todayIdx + 1, 11),
      projectId: personal.id,
      reminders: [{ id: uid("r"), offsetMin: 30 }],
    }),
    stamp({
      type: "event",
      title: "Fall career fair",
      start: at(monday, todayIdx + 4, 11),
      end: at(monday, todayIdx + 4, 15),
      allDay: true,
      location: "Student Union",
      projectId: career.id,
    }),
  );

  // ---- tasks
  const labReport = stamp({
    type: "task",
    title: "BIO 201 lab report",
    start: at(monday, todayIdx, 18, 30),
    end: at(monday, todayIdx, 20, 30),
    dueAt: at(monday, todayIdx + 2, 23, 59),
    status: "doing",
    priority: 3,
    projectId: school.id,
    estimateMin: 150,
    tagIds: [tag("assignment"), tag("lab")],
    reminders: [{ id: uid("r"), offsetMin: 120 }],
    body: "Compare enzyme activity across pH levels. Include the standard curve and error bars.",
  });
  items.push(labReport);

  const sub = (title: string, order: number, done = false): Item =>
    stamp({
      type: "task",
      title,
      parentId: labReport.id,
      projectId: school.id,
      priority: 0,
      status: done ? "done" : "todo",
      completedAt: done ? now - 3_600_000 : null,
      order,
    });
  items.push(sub("Draft introduction", 0, true), sub("Analyze gel results", 1), sub("Format references in APA", 2));

  const ps4 = stamp({
    type: "task",
    title: "Problem set 4",
    dueAt: at(monday, todayIdx + 1, 23, 59),
    priority: 3,
    projectId: school.id,
    estimateMin: 90,
    tagIds: [tag("assignment")],
  });
  items.push(ps4);
  items.push(
    stamp({ type: "task", title: "Q1–Q3 (limits)", parentId: ps4.id, order: 0, projectId: school.id, status: "todo" }),
    stamp({ type: "task", title: "Q4–Q6 (derivatives)", parentId: ps4.id, order: 1, projectId: school.id, status: "todo" }),
  );

  items.push(
    stamp({
      type: "task",
      title: "Read Ch. 6–7 (cell respiration)",
      // Due on the day, not at a clock time: a reading assignment is due
      // Friday, not at one minute to midnight.
      dueAt: at(monday, todayIdx + 3, 0),
      dueAllDay: true,
      priority: 2,
      projectId: school.id,
      estimateMin: 60,
      tagIds: [tag("reading")],
    }),
    stamp({
      type: "task",
      title: "Buy groceries",
      start: at(monday, todayIdx, 17),
      end: at(monday, todayIdx, 17, 45),
      priority: 1,
      projectId: personal.id,
      estimateMin: 45,
    }),
    stamp({
      type: "task",
      title: "Book dentist appointment",
      priority: 1,
      projectId: personal.id,
      tagIds: [tag("health")],
    }),
    stamp({
      type: "task",
      title: "Apply to summer internship",
      dueAt: at(monday, todayIdx + 9, 23, 59),
      priority: 2,
      projectId: career.id,
      estimateMin: 120,
      body: "Deadline is rolling — aim to submit by the end of next week.",
    }),
  );

  const internship = items[items.length - 1];
  items.push(
    stamp({ type: "task", title: "Update resume", parentId: internship.id, order: 0, projectId: career.id }),
    stamp({ type: "task", title: "Shortlist 5 roles", parentId: internship.id, order: 1, projectId: career.id }),
    stamp({ type: "task", title: "Draft cover letter", parentId: internship.id, order: 2, projectId: career.id }),
  );

  // The task never repeats; its block does. Sunday evening stays booked while
  // the task itself is a single piece of work that is due on Sunday.
  items.push(
    stamp({
      type: "task",
      title: "Weekly review",
      timeblocks: [
        {
          id: uid("tb"),
          start: at(monday, 6, 19),
          end: at(monday, 6, 19, 45),
          recurrence: { rrule: "FREQ=WEEKLY;BYDAY=SU" },
        },
      ],
      start: at(monday, 6, 19),
      end: at(monday, 6, 19, 45),
      dueAt: at(monday, 6, 19),
      priority: 1,
      projectId: personal.id,
      estimateMin: 45,
    }),
  );

  // ---- notes
  items.push(
    stamp({
      type: "note",
      title: "BIO 201 — Lecture 12",
      projectId: school.id,
      tagIds: [tag("reading")],
      body:
        "# Cellular respiration\n\nThree stages to remember:\n\n1. **Glycolysis** — cytoplasm, net 2 ATP\n2. **Krebs cycle** — mitochondrial matrix, 2 ATP + NADH/FADH2\n3. **Electron transport chain** — inner membrane, ~28 ATP\n\n> Exam hint: Prof. Lin loves questions about the chemiosmotic gradient.\n\n- [x] Review lecture slides\n- [ ] Re-read section 7.3\n- [ ] Make flashcards for the enzyme names",
    }),
    stamp({
      type: "note",
      title: "Weekly review",
      body:
        "# Weekly review\n\n**What went well**\n\n**What slipped**\n\n**Top 3 for next week**\n\n1.\n2.\n3.\n\n_Keep this under 10 minutes._",
    }),
  );

  await db.items.bulkAdd(items);

  // ---- goals: one of each span, so the page and both views have something
  const goal = (title: string, span: GoalSpan, start: Date, extra: Partial<Goal> = {}): Goal => {
    const startTs = start.getTime();
    return {
      id: uid("g"),
      title,
      span,
      start: startTs,
      end: goalEnd(span, startTs),
      createdAt: now,
      updatedAt: now,
      ...extra,
    };
  };
  await db.goals.bulkAdd([
    goal("Finish BIO 201 strong", "month", startOfMonth(now), {
      projectId: school.id,
      body: "Stay current on lecture notes and walk into the final with a B+ or better.",
    }),
    goal("Land a summer internship", "year", startOfYear(now), {
      projectId: career.id,
      body: "Rolling applications — keep the resume warm and apply to at least one role a week.",
    }),
    goal("Read 20 books", "open", addDays(startOfDay(now), -120), {
      projectId: personal.id,
      body: "Roughly a book a fortnight. Anything counts as long as I finish it.",
    }),
  ]);

  const todayStart = startOfDay(now).getTime();
  await db.focusSessions.bulkAdd([
    { id: uid("f"), startedAt: todayStart + 9 * 3_600_000, endedAt: todayStart + 9.75 * 3_600_000, plannedMin: 45, label: "Reading" },
    { id: uid("f"), startedAt: todayStart + 14 * 3_600_000, endedAt: todayStart + 14.5 * 3_600_000, plannedMin: 30, label: "Problem set" },
  ]);

  // ---- habits: things done again and again, with a month of history behind
  // them so the streak, the week strip and the 30-day rate all say something.
  const habitStart = addDays(today, -28);
  const habit = (name: string, days: number[], color: string, note: string, order: number): Habit => ({
    id: uid("h"),
    name,
    days,
    interval: 1,
    color,
    note,
    start: habitStart.getTime(),
    order,
    createdAt: now,
    updatedAt: now,
  });

  const walk = habit("Morning walk", [1, 3, 5], "#0d9488", "Twenty minutes before class.", 0);
  const read = habit(
    "Read 20 pages",
    [0, 1, 2, 3, 4, 5, 6],
    "#4f46e5",
    "Anything counts, as long as it is finished.",
    1,
  );
  const guitar = habit("Guitar practice", [2, 4, 6], "#d97706", "", 2);
  await db.habits.bulkAdd([walk, read, guitar]);

  // Missing days are counted among the days the habit actually runs on, so a
  // miss always costs the streak and the rate never reads a flat 100%.
  const plans: { habit: Habit; missed: number[]; today?: boolean }[] = [
    { habit: walk, missed: [2, 6, 11], today: true },
    { habit: read, missed: [4, 11], today: true },
    { habit: guitar, missed: [3, 9] },
  ];
  const checkins: HabitCheckin[] = [];
  for (const plan of plans) {
    const dueDays: number[] = [];
    for (let ago = 28; ago >= 0; ago--) {
      const day = addDays(today, -ago);
      if (plan.habit.days.includes(day.getDay())) dueDays.push(day.getTime());
    }
    dueDays.forEach((day, i) => {
      // `missed` counts back from today: 0 is the most recent day it runs on.
      const index = dueDays.length - 1 - i;
      if (plan.missed.includes(index)) return;
      // Today is left open on purpose for some habits: an unticked day is a
      // decision still to make, not a broken streak.
      if (day === today.getTime() && !plan.today) return;
      checkins.push({
        id: checkinId(plan.habit.id, day),
        habitId: plan.habit.id,
        day,
        createdAt: day + 8 * 3_600_000,
      });
    });
  }
  await db.habitCheckins.bulkAdd(checkins);

  await setSetting("seeded", true);
}
