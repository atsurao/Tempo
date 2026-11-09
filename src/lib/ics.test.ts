import { describe, expect, it } from "vitest";
import { normalizeTimes, parseIcs } from "./ics";

function at(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

const wrap = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n${body}END:VCALENDAR\r\n`;

describe("parseIcs", () => {
  it("reads a basic timed event and its UID", () => {
    const result = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:abc-123",
          "SUMMARY:Design review",
          "DTSTART:20260706T130000Z",
          "DTEND:20260706T140000Z",
          "LOCATION:Room 2",
          "END:VEVENT",
        ].join("\r\n") + "\r\n",
      ),
    );
    expect(result.total).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.entries).toHaveLength(1);
    const [entry] = result.entries;
    expect(entry.uid).toBe("abc-123");
    expect(entry.type).toBe("event");
    expect(entry.title).toBe("Design review");
    expect(entry.location).toBe("Room 2");
    expect(entry.start).toBe(Date.UTC(2026, 6, 6, 13, 0, 0));
    expect(entry.end).toBe(Date.UTC(2026, 6, 6, 14, 0, 0));
    expect(entry.allDay).toBe(false);
  });

  it("unfolds continuation lines and unescapes text", () => {
    const result = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:fold-1",
          "SUMMARY:Quarterly planning session",
          "  with the whole team",
          "DESCRIPTION:Line one\\nLine two\\, still one field",
          "DTSTART;VALUE=DATE:20260801",
          "END:VEVENT",
        ].join("\r\n") + "\r\n",
      ),
    );
    const [entry] = result.entries;
    expect(entry.title).toBe("Quarterly planning session with the whole team");
    expect(entry.description).toBe("Line one\nLine two, still one field");
  });

  it("resolves TZID wall-clock times against the named zone", () => {
    const result = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:tz-1",
          "SUMMARY:Read in the park",
          "DTSTART;TZID=America/New_York:20260704T090000",
          "DTEND;TZID=America/New_York:20260704T100000",
          "END:VEVENT",
        ].join("\r\n") + "\r\n",
      ),
    );
    const [entry] = result.entries;
    // 09:00 EDT is 13:00 UTC.
    expect(entry.start).toBe(Date.UTC(2026, 6, 4, 13, 0, 0));
    expect(entry.end).toBe(Date.UTC(2026, 6, 4, 14, 0, 0));
  });

  it("keeps a TZID it cannot resolve as local wall-clock time", () => {
    const result = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:tz-2",
          "SUMMARY:Old calendar",
          "DTSTART;TZID=Mars/Olympus:20260801T093000",
          "END:VEVENT",
        ].join("\r\n") + "\r\n",
      ),
    );
    expect(result.entries[0].start).toBe(at(2026, 8, 1, 9, 30));
  });

  it("turns RFC all-day ends into the inclusive last instant", () => {
    const result = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:allday-1",
          "SUMMARY:Conference",
          "DTSTART;VALUE=DATE:20260801",
          "DTEND;VALUE=DATE:20260803",
          "END:VEVENT",
        ].join("\r\n") + "\r\n",
      ),
    );
    const [entry] = result.entries;
    expect(entry.allDay).toBe(true);
    expect(normalizeTimes(entry)).toEqual({
      start: at(2026, 8, 1),
      end: at(2026, 8, 2) + 86_400_000 - 1,
    });
  });

  it("derives an end from DURATION and defaults a missing end", () => {
    const result = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:dur-1",
          "SUMMARY:Deep work",
          "DTSTART:20260707T080000Z",
          "DURATION:PT1H30M",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:dur-2",
          "SUMMARY:Untimed",
          "DTSTART:20260707T100000Z",
          "END:VEVENT",
        ].join("\r\n") + "\r\n",
      ),
    );
    expect(normalizeTimes(result.entries[0]).end).toBe(Date.UTC(2026, 6, 7, 9, 30));
    expect(result.entries[1].end).toBeNull();
    expect(normalizeTimes(result.entries[1])).toEqual({
      start: Date.UTC(2026, 6, 7, 10, 0),
      end: Date.UTC(2026, 6, 7, 10, 0),
    });
  });

  it("reads recurrence, exclusions, overrides and alarm offsets", () => {
    const result = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:series-1",
          "SUMMARY:Standup",
          "DTSTART:20260706T090000Z",
          "DTEND:20260706T091500Z",
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "EXDATE:20260713T090000Z,20260727T090000Z",
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          "TRIGGER:-PT10M",
          "END:VALARM",
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          "TRIGGER:-PT10M",
          "END:VALARM",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:series-1",
          "RECURRENCE-ID:20260720T090000Z",
          "SUMMARY:Standup (moved)",
          "DTSTART:20260720T100000Z",
          "DTEND:20260720T101500Z",
          "END:VEVENT",
        ].join("\r\n") + "\r\n",
      ),
    );
    const [master, override] = result.entries;
    expect(master.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(master.exdates).toEqual([
      Date.UTC(2026, 6, 13, 9, 0),
      Date.UTC(2026, 6, 27, 9, 0),
    ]);
    expect(master.reminders).toEqual([10]);
    expect(override.recurrenceId).toBe(Date.UTC(2026, 6, 20, 9, 0));
    expect(override.start).toBe(Date.UTC(2026, 6, 20, 10, 0));
  });

  it("maps VTODO deadlines, status, priority and categories", () => {
    const result = parseIcs(
      wrap(
        [
          "BEGIN:VTODO",
          "UID:todo-1",
          "SUMMARY:File taxes",
          "DUE;VALUE=DATE:20260415",
          "STATUS:COMPLETED",
          "PRIORITY:1",
          "CATEGORIES:Finance,Home",
          "END:VTODO",
        ].join("\r\n") + "\r\n",
      ),
    );
    const [entry] = result.entries;
    expect(entry.type).toBe("task");
    expect(entry.dueAt).toBe(at(2026, 4, 15));
    expect(entry.allDay).toBe(true);
    expect(entry.completed).toBe(true);
    expect(entry.priority).toBe(1);
    expect(entry.categories).toEqual(["Finance", "Home"]);
  });

  it("drops cancelled series but keeps cancelled instances", () => {
    const result = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:dead-1",
          "SUMMARY:Gone",
          "DTSTART:20260701T090000Z",
          "STATUS:CANCELLED",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:live-1",
          "SUMMARY:Series",
          "DTSTART:20260701T090000Z",
          "RRULE:FREQ=DAILY",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:live-1",
          "RECURRENCE-ID:20260702T090000Z",
          "SUMMARY:Series",
          "DTSTART:20260702T090000Z",
          "STATUS:CANCELLED",
          "END:VEVENT",
        ].join("\r\n") + "\r\n",
      ),
    );
    expect(result.total).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.entries.map((e) => e.uid)).toEqual(["live-1", "live-1"]);
    expect(result.entries[1].cancelled).toBe(true);
  });

  it("keeps the calendar name and ignores entries with no time at all", () => {
    const result = parseIcs(
      wrap(
        [
          "X-WR-CALNAME:Work & Play",
          "BEGIN:VEVENT",
          "UID:no-time",
          "SUMMARY:Undated note",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:timed",
          "SUMMARY:Timed",
          "DTSTART:20260701T090000Z",
          "END:VEVENT",
        ].join("\r\n") + "\r\n",
      ),
    );
    expect(result.calendarName).toBe("Work & Play");
    expect(result.skipped).toBe(1);
    expect(result.entries).toHaveLength(1);
  });

  it("treats a file with no calendar as empty rather than throwing", () => {
    const result = parseIcs("not a calendar at all");
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
  });
});
