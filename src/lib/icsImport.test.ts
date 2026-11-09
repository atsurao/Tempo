import { describe, expect, it } from "vitest";
import type { Item } from "../types";
import { planImport } from "./icsImport";

function at(y: number, mo: number, d: number, h = 0, mi = 0): number {
  return new Date(y, mo - 1, d, h, mi).getTime();
}

const wrap = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;

const series = wrap(
  [
    "BEGIN:VEVENT",
    "UID:standup@tempo.test",
    "SUMMARY:Standup",
    "DTSTART:20260706T090000Z",
    "DTEND:20260706T091500Z",
    "RRULE:FREQ=WEEKLY;BYDAY=MO",
    "EXDATE:20260713T090000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:standup@tempo.test",
    "RECURRENCE-ID:20260720T090000Z",
    "SUMMARY:Standup (moved)",
    "DTSTART:20260720T100000Z",
    "DTEND:20260720T101500Z",
    "END:VEVENT",
  ].join("\r\n") + "\r\n",
);

function existingItem(patch: Partial<Item>): Item {
  return {
    id: "existing-1",
    type: "event",
    title: "Standup",
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

describe("planImport", () => {
  it("plans a plain event with its reminder and source UID", () => {
    const plan = planImport(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:lunch@tempo.test",
          "SUMMARY:Lunch with Ada",
          "DTSTART:20260708T120000Z",
          "DTEND:20260708T130000Z",
          "BEGIN:VALARM",
          "TRIGGER:-PT15M",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n") + "\r\n",
      ),
      [],
    );

    expect(plan.counts).toMatchObject({ events: 1, tasks: 0, duplicates: 0, skipped: 0 });
    const [row] = plan.rows;
    expect(row.item.title).toBe("Lunch with Ada");
    expect(row.item.type).toBe("event");
    expect(row.item.start).toBe(Date.UTC(2026, 6, 8, 12, 0));
    expect(row.item.end).toBe(Date.UTC(2026, 6, 8, 13, 0));
    expect(row.item.sourceUid).toBe("lunch@tempo.test");
    expect(row.item.reminders?.map((r) => r.offsetMin)).toEqual([15]);
    expect(plan.earliest).toBe(Date.UTC(2026, 6, 8, 12, 0));
  });

  it("plans a completed todo as a done task on its due date", () => {
    const plan = planImport(
      wrap(
        [
          "BEGIN:VTODO",
          "UID:taxes@tempo.test",
          "SUMMARY:File taxes",
          "DUE;VALUE=DATE:20260415",
          "STATUS:COMPLETED",
          "PRIORITY:2",
          "CATEGORIES:Finance,Home",
          "END:VTODO",
        ].join("\r\n") + "\r\n",
      ),
      [],
    );

    const [row] = plan.rows;
    expect(plan.counts).toMatchObject({ events: 0, tasks: 1 });
    expect(row.item.type).toBe("task");
    expect(row.item.dueAt).toBe(at(2026, 4, 15));
    expect(row.item.start).toBeNull();
    expect(row.item.status).toBe("done");
    expect(row.item.completedAt).not.toBeNull();
    expect(row.item.priority).toBe(3);
    expect(row.categories).toEqual(["Finance", "Home"]);
  });

  it("splits a series into a master, a hidden exclusion and an override", () => {
    const plan = planImport(series, []);

    expect(plan.counts.events).toBe(2);
    expect(plan.counts.recurring).toBe(1);
    expect(plan.rows).toHaveLength(3);

    const master = plan.rows[0].item;
    expect(master.recurrence).toEqual({ rrule: "FREQ=WEEKLY;BYDAY=MO" });

    const hidden = plan.rows[1].item;
    expect(hidden.cancelled).toBe(true);
    expect(hidden.recurrenceParentId).toBe(master.id);
    expect(hidden.originalStart).toBe(Date.UTC(2026, 6, 13, 9, 0));

    const override = plan.rows[2].item;
    expect(override.recurrenceParentId).toBe(master.id);
    expect(override.originalStart).toBe(Date.UTC(2026, 6, 20, 9, 0));
    expect(override.start).toBe(Date.UTC(2026, 6, 20, 10, 0));
    expect(override.recurrence).toBeNull();
    expect(override.cancelled).toBeFalsy();
  });

  it("skips entries already imported but still links new overrides", () => {
    const plan = planImport(series, [
      existingItem({ id: "kept", sourceUid: "standup@tempo.test" }),
      existingItem({
        id: "hidden",
        sourceUid: "standup@tempo.test",
        recurrenceParentId: "kept",
        originalStart: Date.UTC(2026, 6, 13, 9, 0),
        cancelled: true,
      }),
    ]);

    expect(plan.counts.duplicates).toBe(1);
    expect(plan.counts.events).toBe(1);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].item.recurrenceParentId).toBe("kept");
  });

  it("re-importing the same file yields nothing new the second time", () => {
    const first = planImport(series, []);
    const second = planImport(series, first.rows.map((row) => row.item));
    expect(second.counts.duplicates).toBe(2);
    expect(second.rows).toHaveLength(0);
  });

  it("keeps an event whose rule cannot be expanded as a one-off", () => {
    const plan = planImport(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:weird@tempo.test",
          "SUMMARY:Odd repeat",
          "DTSTART:20260709T090000Z",
          "RRULE:FREQ=FORTNIGHTLY;NONSENSE=YES",
          "END:VEVENT",
        ].join("\r\n") + "\r\n",
      ),
      [],
    );
    expect(plan.rows[0].item.recurrence).toBeNull();
    expect(plan.counts.recurring).toBe(0);
    expect(plan.rows[0].item.start).toBe(Date.UTC(2026, 6, 9, 9, 0));
  });

  it("keeps a moved orphan instance and drops a cancelled orphan", () => {
    const plan = planImport(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:orphan@tempo.test",
          "RECURRENCE-ID:20260710T090000Z",
          "SUMMARY:Moved orphan",
          "DTSTART:20260710T140000Z",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:orphan@tempo.test",
          "RECURRENCE-ID:20260711T090000Z",
          "SUMMARY:Gone orphan",
          "DTSTART:20260711T090000Z",
          "STATUS:CANCELLED",
          "END:VEVENT",
        ].join("\r\n") + "\r\n",
      ),
      [],
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].item.title).toBe("Moved orphan");
    expect(plan.rows[0].item.recurrenceParentId).toBeUndefined();
    expect(plan.counts.skipped).toBe(1);
  });

  it("does not create an exception for an EXDATE an earlier import already made", () => {
    const first = planImport(series, []);
    const again = planImport(series, first.rows.map((row) => row.item));
    expect(again.rows).toHaveLength(0);
    expect(again.counts.duplicates).toBe(2);
  });
});
