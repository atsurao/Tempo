import { useState } from "react";
import { Repeat } from "lucide-react";
import {
  WEEKDAYS,
  buildRRuleString,
  describeRecurrenceShort,
  recurrenceFormOf,
  type RecurrenceForm,
} from "../../lib/recurrence";
import { format } from "date-fns";
import { Select } from "../ui/Select";

interface Props {
  value?: string | null;
  onChange: (rrule: string | null) => void;
  start?: number | null;
}

export function RecurrenceField({ value, onChange, start }: Props) {
  const [open, setOpen] = useState(false);
  const form = recurrenceFormOf(value);

  const update = (patch: Partial<RecurrenceForm>) => {
    onChange(buildRRuleString({ ...form, ...patch }));
  };

  if (!value && !open) {
    return (
      <button className="recur-summary" onClick={() => setOpen(true)}>
        <Repeat size={12} style={{ color: "var(--text-3)" }} />
        Does not repeat
      </button>
    );
  }

  if (!open) {
    return (
      <div className="sheet-row">
        <button className="recur-summary" style={{ flex: 1 }} onClick={() => setOpen(true)}>
          <Repeat size={12} style={{ color: "var(--accent-ink)" }} />
          {describeRecurrenceShort(value)}
        </button>
        <button
          className="btn sm"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="recur-box">
      <div className="sheet-grid">
        <label className="field">
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>Repeats</span>
          <Select
            value={form.freq}
            ariaLabel="Repeats"
            options={[
              { value: "DAILY", label: "Daily" },
              { value: "WEEKLY", label: "Weekly" },
              { value: "MONTHLY", label: "Monthly" },
              { value: "YEARLY", label: "Yearly" },
            ]}
            onChange={(v) => {
              const freq = v as RecurrenceForm["freq"];
              update({ freq, byDay: freq === "WEEKLY" ? form.byDay : [] });
            }}
          />
        </label>
        <label className="field">
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>Every</span>
          <div className="sheet-row">
            <input
              type="number"
              min={1}
              max={99}
              value={form.interval}
              onChange={(e) => update({ interval: Math.max(1, Number(e.target.value) || 1) })}
            />
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>
              {form.freq === "DAILY" ? "days" : form.freq === "WEEKLY" ? "weeks" : form.freq === "MONTHLY" ? "months" : "years"}
            </span>
          </div>
        </label>
      </div>

      {form.freq === "WEEKLY" && (
        <div className="recur-days">
          {WEEKDAYS.map((day) => {
            const active = form.byDay.includes(day.code);
            return (
              <button
                key={day.code}
                data-active={active}
                title={day.label}
                onClick={() =>
                  update({
                    byDay: active
                      ? form.byDay.filter((d) => d !== day.code)
                      : [...form.byDay, day.code],
                  })
                }
              >
                {day.code}
              </button>
            );
          })}
        </div>
      )}

      <div className="sheet-row">
        <Select
          value={form.end.type}
          ariaLabel="Repeats until"
          style={{ width: 118, flex: "none" }}
          options={[
            { value: "never", label: "Never ends" },
            { value: "on", label: "Ends on date" },
            { value: "after", label: "Ends after" },
          ]}
          onChange={(v) => {
            const type = v as RecurrenceForm["end"]["type"];
            if (type === "never") update({ end: { type: "never" } });
            else if (type === "on")
              update({
                end: { type: "on", date: start ?? Date.now() + 30 * 86_400_000 },
              });
            else update({ end: { type: "after", count: 10 } });
          }}
        />

        {form.end.type === "on" && (
          <input
            type="date"
            value={format(form.end.date, "yyyy-MM-dd")}
            onChange={(e) => {
              const ts = new Date(`${e.target.value}T23:59`).getTime();
              if (!Number.isNaN(ts)) update({ end: { type: "on", date: ts } });
            }}
          />
        )}
        {form.end.type === "after" && (
          <div className="sheet-row">
            <input
              type="number"
              min={1}
              value={form.end.count}
              onChange={(e) =>
                update({ end: { type: "after", count: Math.max(1, Number(e.target.value) || 1) } })
              }
            />
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>times</span>
          </div>
        )}
      </div>

      <div className="sheet-row">
        <span style={{ flex: 1, fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>
          {value ? describeRecurrenceShort(value) : "Set a rule to see a preview"}
        </span>
        <button className="btn sm" onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
    </div>
  );
}
