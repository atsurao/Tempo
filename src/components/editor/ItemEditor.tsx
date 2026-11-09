import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Bell,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Copy,
  FileText,
  Link2,
  MapPin,
  Plus,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import type { Item, ItemType, Priority, Reminder, TimeBlock } from "../../types";
import { PRIORITY_LABEL, REMINDER_PRESETS } from "../../types";
import { useUI, type EditorDraft } from "../../store/ui";
import { useItems, useProjects, useTags, useWorkProjects } from "../../db/hooks";
import {
  cancelOccurrence,
  duplicateItem,
  ensureTag,
  overrideOccurrence,
  purgeItem,
  restoreSubtree,
  softDeleteItem,
  splitSeries,
  updateItem,
} from "../../db/db";
import { createFromDraft } from "../../lib/create";
import { uid } from "../../lib/id";
import { eod, minutesOfDay, sod } from "../../lib/date";
import { blocksPatch, newBlock, suggestBlock } from "../../lib/timeblocks";
import { masterOf } from "../../lib/tasks";
import { RecurrenceField } from "./RecurrenceField";
import { Select } from "../ui/Select";
import { TabStrip, type TabItem } from "../ui/TabStrip";
import { TimeField } from "../ui/TimeField";
import { useIsMobile } from "../../hooks/useIsMobile";

type Scope = "single" | "following" | "all";

const TYPE_META: Record<ItemType, { label: string; icon: typeof CalendarDays }> = {
  event: { label: "Event", icon: CalendarDays },
  task: { label: "Task", icon: CheckSquare },
  note: { label: "Note", icon: FileText },
};

function dateValue(ts?: number | null): string {
  return ts ? format(ts, "yyyy-MM-dd") : "";
}
export function ItemEditor() {
  const editor = useUI((s) => s.editor);
  const closeEditor = useUI((s) => s.closeEditor);
  const toast = useUI((s) => s.toast);
  const items = useItems();
  const projects = useProjects();
  const workProjects = useWorkProjects();
  const tags = useTags();

  const [draft, setDraft] = useState<EditorDraft | null>(editor?.draft ?? null);
  const [scope, setScope] = useState<Scope>("single");
  const [tagInput, setTagInput] = useState("");
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const [deleteMenu, setDeleteMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState<"details" | "schedule" | "notes">("details");
  const mobile = useIsMobile();
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(editor?.draft ?? null);
    setScope("single");
    setDeleteMenu(false);
    setTagInput("");
    setOpenBlockId(null);
    setSection("details");
  }, [editor]);

  useEffect(() => {
    if (editor && !editor.itemId) {
      const id = window.setTimeout(() => titleRef.current?.focus(), 40);
      return () => window.clearTimeout(id);
    }
  }, [editor]);

  const existing = useMemo(
    () => (editor?.itemId ? items.find((i) => i.id === editor.itemId) : undefined),
    [editor, items],
  );

  if (!editor || !draft) return null;

  const master = existing ? masterOf(existing, items) : undefined;
  const isRecurringInstance = Boolean(master?.recurrence && editor.occurrenceStart != null);
  /** An exception row of a series — an event series or a repeating task block. */
  const seriesStart = editor.occurrenceStart ?? existing?.originalStart ?? null;
  const isSeriesInstance = Boolean(
    seriesStart != null && (master?.recurrence || existing?.recurrenceParentId),
  );
  const duration = (draft.end ?? 0) - (draft.start ?? 0);

  const patch = (p: Partial<EditorDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const setStartDate = (value: string) => {
    if (!value || !draft) return;
    const time = draft.start ? format(draft.start, "HH:mm") : "09:00";
    const ts = new Date(`${value}T${time}`).getTime();
    const span = duration > 0 ? duration : 3_600_000;
    patch({ start: ts, end: ts + span });
  };

  const setStartTime = (minutes: number) => {
    if (!draft?.start) return;
    const base = new Date(draft.start);
    base.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    const span = duration > 0 ? duration : 3_600_000;
    patch({ start: base.getTime(), end: base.getTime() + span });
  };

  const setEndTime = (minutes: number) => {
    if (!draft?.start) return;
    const base = new Date(draft.end ?? draft.start);
    base.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    let end = base.getTime();
    if (end <= draft.start) end += 86_400_000;
    patch({ end });
  };

  const setDueDate = (value: string) => {
    if (!value) return;
    if (draft.dueAllDay) {
      patch({ dueAt: eod(new Date(`${value}T12:00`).getTime()) });
      return;
    }
    const time = draft.dueAt ? format(draft.dueAt, "HH:mm") : "23:59";
    const ts = new Date(`${value}T${time}`).getTime();
    patch({ dueAt: ts });
  };

  const setDueTime = (minutes: number) => {
    const base = new Date(draft.dueAt ?? Date.now());
    base.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    patch({ dueAt: base.getTime() });
  };

  /** Due on the day: no clock time, and the task stays open until midnight. */
  const toggleDueAllDay = () => {
    if (!draft) return;
    const base = draft.dueAt ?? Date.now();
    if (draft.dueAllDay) {
      const morning = new Date(sod(base));
      morning.setHours(9, 0, 0, 0);
      patch({ dueAllDay: false, dueAt: morning.getTime() });
    } else {
      patch({ dueAllDay: true, dueAt: eod(base) });
    }
  };

  const blocks = draft.timeblocks ?? [];

  /** Keeps the block list and the mirrored start/end in one place. */
  const setBlocks = (next: TimeBlock[]) => patch(blocksPatch(next));

  const addBlock = () => {
    const span = suggestBlock(blocks);
    const block = newBlock(span.start, span.end);
    setBlocks([...blocks, block]);
    setOpenBlockId(block.id);
  };

  const updateBlock = (id: string, next: Partial<TimeBlock>) =>
    setBlocks(blocks.map((block) => (block.id === id ? { ...block, ...next } : block)));

  const setBlockDate = (block: TimeBlock, value: string) => {
    if (!value) return;
    const time = format(block.start, "HH:mm");
    const start = new Date(`${value}T${time}`).getTime();
    updateBlock(block.id, { start, end: start + Math.max(15 * 60_000, block.end - block.start) });
  };

  const setBlockStart = (block: TimeBlock, minutes: number) => {
    const start = new Date(block.start);
    start.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    const end = new Date(block.end);
    end.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (end.getTime() <= start.getTime()) end.setTime(start.getTime() + 60 * 60_000);
    updateBlock(block.id, { start: start.getTime(), end: end.getTime() });
  };

  const setBlockEnd = (block: TimeBlock, minutes: number) => {
    const end = new Date(block.end);
    end.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    updateBlock(block.id, {
      end: Math.max(end.getTime(), block.start + 15 * 60_000),
    });
  };

  const toggleAllDay = () => {
    if (!draft) return;
    if (draft.allDay) {
      const base = draft.start ?? Date.now();
      patch({ allDay: false, start: sod(base) + 9 * 3_600_000, end: sod(base) + 10 * 3_600_000 });
    } else {
      const base = draft.start ?? Date.now();
      patch({ allDay: true, start: sod(base), end: sod(base) + 86_400_000 - 1 });
    }
  };

  const addTag = async (raw: string) => {
    const name = raw.trim().replace(/^#/, "");
    if (!name) return;
    const tag = await ensureTag(name);
    setDraft((d) =>
      d ? { ...d, tagIds: Array.from(new Set([...(d.tagIds ?? []), tag.id])) } : d,
    );
    setTagInput("");
  };

  const addReminder = (offsetMin: number) => {
    const reminder: Reminder = { id: uid("r"), offsetMin };
    setDraft((d) => (d ? { ...d, reminders: [...(d.reminders ?? []), reminder] } : d));
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const type = draft.type;
      let start = draft.start ?? null;
      let end = draft.end ?? null;

      if (type === "event" && start == null) {
        start = sod(Date.now()) + 9 * 3_600_000;
        end = start + 3_600_000;
      }
      // A task's calendar placement is the first of its blocks; with none it
      // has no time on the calendar at all, which is a valid way to work.
      const placement = type === "task" ? blocksPatch(draft.timeblocks ?? []) : { start, end };

      const toPatch: Partial<Item> = {
        type,
        title: draft.title?.trim() || (type === "note" ? "Untitled note" : "Untitled"),
        body: draft.body ?? "",
        start: type === "note" ? null : (placement.start ?? null),
        end: type === "note" ? null : (placement.end ?? null),
        timeblocks: type === "task" ? (placement.timeblocks ?? []) : [],
        allDay: Boolean(draft.allDay),
        dueAt: type === "event" || type === "note" ? null : (draft.dueAt ?? null),
        dueAllDay: type === "task" ? Boolean(draft.dueAllDay) : undefined,
        projectId: draft.projectId ?? null,
        workProjectId:
          type === "task"
            ? (draft.workProjectId !== undefined
                ? draft.workProjectId
                : (existing?.workProjectId ?? null))
            : null,
        tagIds: draft.tagIds ?? [],
        priority: draft.priority ?? 0,
        status: type === "task" ? (draft.status ?? "todo") : undefined,
        estimateMin: type === "task" ? (draft.estimateMin ?? null) : null,
        reminders: draft.reminders ?? [],
        // Only events repeat. A task repeats nothing but its blocks, and each
        // block carries its own rule.
        recurrence: type === "task" ? null : (draft.recurrence ?? null),
        location: draft.location || "",
        url: draft.url || "",
      };

      if (!editor.itemId) {
        await createFromDraft({ ...draft, type, start, end });
        toast(type === "event" ? "Event created" : type === "task" ? "Task created" : "Note created");
      } else if (master && isRecurringInstance) {
        if (scope === "single") {
          await overrideOccurrence(master, editor.occurrenceStart!, {
            ...toPatch,
            recurrence: null,
            start,
            end,
          });
          toast("Updated this occurrence only");
        } else if (scope === "following") {
          await splitSeries(master, editor.occurrenceStart!, toPatch);
          toast("Split the series from here");
        } else {
          await updateItem(master.id, toPatch);
          if (existing?.recurrenceParentId) await purgeItem(existing.id);
          toast("Updated the series");
        }
      } else {
        await updateItem(editor.itemId, toPatch);
        toast("Saved");
      }
      closeEditor();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (mode: Scope) => {
    if (!editor?.itemId) return;
    setDeleteMenu(false);
    if (mode === "single" && master && seriesStart != null && isSeriesInstance) {
      const exceptionId = await cancelOccurrence(master, seriesStart);
      toast("Removed this occurrence", {
        actionLabel: "Undo",
        action: () => void purgeItem(exceptionId),
      });
    } else {
      // "All" must take the whole series, even when the editor was opened on
      // an instance that had already grown its own exception row.
      const targetId = isSeriesInstance && master ? master.id : editor.itemId;
      await softDeleteItem(targetId);
      toast("Deleted", {
        actionLabel: "Undo",
        action: () => void restoreSubtree(targetId),
      });
    }
    closeEditor();
  };

  const duplicate = async () => {
    if (!editor?.itemId) return;
    await duplicateItem(editor.itemId);
    toast("Duplicated");
    closeEditor();
  };

  const projectTags = (draft.tagIds ?? [])
    .map((id) => tags.find((t) => t.id === id))
    .filter(Boolean);

  const titleField = (
    <input
      ref={titleRef}
      className="sheet-title"
      value={draft.title ?? ""}
      placeholder={draft.type === "note" ? "Note title" : "What's this?"}
      onChange={(e) => patch({ title: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
      }}
    />
  );

  // A phone gets one section at a time. A note is short enough to stay whole.
  const noteType = draft.type === "note";
  const sectionVisible = (key: "details" | "schedule" | "notes") =>
    !mobile || noteType || section === key;
  const sections: TabItem<"details" | "schedule" | "notes">[] = [
    { id: "details", label: "Details", icon: CalendarDays },
    {
      id: "schedule",
      label: draft.type === "task" ? "Blocks" : "Repeat",
      icon: draft.type === "task" ? CalendarClock : Repeat,
      badge: draft.type === "task" ? blocks.length : undefined,
    },
    { id: "notes", label: "Notes", icon: FileText },
  ];

  return (
    <div className="sheet" role="dialog" aria-label="Item editor">
      <div className="sheet-head">
        <div className="sheet-type">
          {(Object.keys(TYPE_META) as ItemType[]).map((type) => {
            const Icon = TYPE_META[type].icon;
            return (
              <button
                key={type}
                data-active={draft.type === type}
                onClick={() => {
                  // An event turned into a task keeps its booked time as the
                  // task's first block instead of losing it on the way over.
                  const asBlock =
                    type === "task" &&
                    draft.type !== "task" &&
                    (draft.timeblocks ?? []).length === 0 &&
                    draft.start != null;
                  patch({
                    type,
                    status: type === "task" ? (draft.status ?? "todo") : draft.status,
                    dueAt: type === "task" ? (draft.dueAt ?? draft.end ?? null) : draft.dueAt,
                    ...(asBlock
                      ? {
                          timeblocks: [
                            {
                              id: uid("tb"),
                              start: draft.start!,
                              end: draft.end ?? draft.start! + 3_600_000,
                              recurrence: draft.recurrence ?? null,
                            },
                          ],
                        }
                      : {}),
                    ...(type === "task" ? {} : { timeblocks: [] }),
                  });
                }}
              >
                <Icon size={11} />
                {TYPE_META[type].label}
              </button>
            );
          })}
        </div>
        <div className="spacer" />
        <button className="icon-btn" onClick={closeEditor} title="Close (Esc)">
          <X size={14} />
        </button>
      </div>

      {mobile && (
        <div className="sheet-titlebar">
          {titleField}
          {!noteType && (
            <TabStrip
              value={section}
              tabs={sections}
              onChange={setSection}
              ariaLabel="Editor sections"
            />
          )}
        </div>
      )}

      <div className="sheet-body">
        {!mobile && titleField}

        {sectionVisible("details") && isRecurringInstance && (
          <div>
            <div className="faint" style={{ fontSize: "var(--fs-xs)", marginBottom: 5 }}>
              <Repeat size={10} style={{ verticalAlign: "-1px" }} /> Part of a repeating series — apply
              changes to:
            </div>
            <div className="scope-row">
              <button data-active={scope === "single"} onClick={() => setScope("single")}>
                This occurrence
              </button>
              <button data-active={scope === "following"} onClick={() => setScope("following")}>
                This & following
              </button>
              <button data-active={scope === "all"} onClick={() => setScope("all")}>
                All events
              </button>
            </div>
          </div>
        )}

        {sectionVisible("details") && draft.type === "event" && (
          <>
            <div className="sheet-grid">
              <label className="field">
                <span className="field-label">Date</span>
                <input
                  type="date"
                  value={dateValue(draft.start)}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">All day</span>
                <button
                  className="btn"
                  data-active={draft.allDay}
                  onClick={toggleAllDay}
                  style={{
                    height: 28,
                    border: "1px solid var(--border)",
                    justifyContent: "flex-start",
                    background: draft.allDay ? "var(--accent-soft)" : "var(--surface-2)",
                    color: draft.allDay ? "var(--accent-ink)" : "var(--text-2)",
                  }}
                >
                  <CheckSquare size={12} />
                  {draft.allDay ? "All day" : "Timed"}
                </button>
              </label>
            </div>

            {!draft.allDay && (
              <div className="sheet-grid">
                <div className="field">
                  <span className="field-label">Starts</span>
                  <TimeField
                    value={draft.start == null ? null : minutesOfDay(draft.start)}
                    onChange={setStartTime}
                    ariaLabel="Starts"
                    step={5}
                  />
                </div>
                <div className="field">
                  <span className="field-label">Ends</span>
                  <TimeField
                    value={draft.end == null ? null : minutesOfDay(draft.end)}
                    onChange={setEndTime}
                    ariaLabel="Ends"
                    step={5}
                  />
                </div>
              </div>
            )}

            <label className="field">
              <span className="field-label">Location</span>
              <div className="sheet-row">
                <MapPin size={12} style={{ color: "var(--text-3)" }} />
                <input
                  className="input"
                  value={draft.location ?? ""}
                  placeholder="Science Hall 2B"
                  onChange={(e) => patch({ location: e.target.value })}
                />
              </div>
            </label>
          </>
        )}

        {sectionVisible("details") && draft.type === "task" && (
          <>
            <div className="sheet-grid">
              <label className="field">
                <span className="field-label">Due date</span>
                <input
                  type="date"
                  value={dateValue(draft.dueAt)}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Due</span>
                <button
                  className="btn"
                  data-active={draft.dueAllDay}
                  onClick={toggleDueAllDay}
                  title="Due on the day, without a clock time"
                  style={{
                    height: 28,
                    border: "1px solid var(--border)",
                    justifyContent: "flex-start",
                    background: draft.dueAllDay ? "var(--accent-soft)" : "var(--surface-2)",
                    color: draft.dueAllDay ? "var(--accent-ink)" : "var(--text-2)",
                  }}
                >
                  <CheckSquare size={12} />
                  {draft.dueAllDay ? "On the day" : "At a time"}
                </button>
              </label>
            </div>

            {!draft.dueAllDay && (
              <div className="field">
                <span className="field-label">Due time</span>
                <TimeField
                  value={draft.dueAt == null ? null : minutesOfDay(draft.dueAt)}
                  onChange={setDueTime}
                  ariaLabel="Due time"
                  step={5}
                />
              </div>
            )}

            <div className="sheet-grid three">
              <label className="field">
                <span className="field-label">Status</span>
                <Select
                  value={draft.status ?? "todo"}
                  ariaLabel="Status"
                  options={[
                    { value: "todo", label: "To do" },
                    { value: "doing", label: "In progress" },
                    { value: "done", label: "Done" },
                  ]}
                  onChange={(v) => patch({ status: v as Item["status"] })}
                />
              </label>
              <label className="field">
                <span className="field-label">Estimate</span>
                <div className="sheet-row">
                  <input
                    type="number"
                    min={0}
                    step={5}
                    value={draft.estimateMin ?? ""}
                    placeholder="—"
                    onChange={(e) =>
                      patch({ estimateMin: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                  <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)" }}>min</span>
                </div>
              </label>
              <label className="field">
                <span className="field-label">Priority</span>
                <Select
                  value={String(draft.priority ?? 0)}
                  ariaLabel="Priority"
                  options={([0, 1, 2, 3] as Priority[]).map((p) => ({
                    value: String(p),
                    label: PRIORITY_LABEL[p],
                  }))}
                  onChange={(v) => patch({ priority: Number(v) as Priority })}
                />
              </label>
            </div>

          </>
        )}

        {sectionVisible("schedule") && draft.type === "task" && (
          <div className="field">
            <div className="block-head">
              <span className="field-label">Time blocks</span>
              <button className="btn sm" onClick={addBlock}>
                <Plus size={11} /> Add block
              </button>
            </div>
              {blocks.length === 0 && (
                <div className="block-empty faint">
                  <CalendarClock size={12} />
                  No time booked. Blocks are optional — add one when the work needs a slot.
                </div>
              )}
              {blocks.map((block) => (
                <div className="block-item" key={block.id} data-open={openBlockId === block.id}>
                  <div className="block-row">
                    <input
                      type="date"
                      aria-label="Block date"
                      value={dateValue(block.start)}
                      onChange={(e) => setBlockDate(block, e.target.value)}
                    />
                    <TimeField
                      ariaLabel="Block start"
                      value={minutesOfDay(block.start)}
                      onChange={(minutes) => setBlockStart(block, minutes)}
                      step={5}
                    />
                    <TimeField
                      ariaLabel="Block end"
                      value={minutesOfDay(block.end)}
                      onChange={(minutes) => setBlockEnd(block, minutes)}
                      step={5}
                    />
                    <button
                      className="icon-btn"
                      data-active={Boolean(block.recurrence) || openBlockId === block.id}
                      title={block.recurrence ? "This block repeats" : "Repeat this block"}
                      aria-label="Repeat this block"
                      onClick={() => setOpenBlockId(openBlockId === block.id ? null : block.id)}
                    >
                      <Repeat size={11} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Remove block"
                      aria-label="Remove block"
                      onClick={() => {
                        setBlocks(blocks.filter((candidate) => candidate.id !== block.id));
                        if (openBlockId === block.id) setOpenBlockId(null);
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                  {openBlockId === block.id && (
                    <div className="block-repeat">
                      <RecurrenceField
                        value={block.recurrence?.rrule ?? null}
                        start={block.start}
                        onChange={(rrule) =>
                          updateBlock(block.id, { recurrence: rrule ? { rrule } : null })
                        }
                      />
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}

        {sectionVisible("details") && (
          <>
        <div className="sheet-sep" />

        <div className="sheet-grid">
          <label className="field">
            <span className="field-label">Calendar</span>
            <Select
              value={draft.projectId ?? ""}
              ariaLabel="Calendar"
              options={[
                { value: "", label: "No calendar" },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
              onChange={(v) => patch({ projectId: v || null })}
            />
          </label>

          {draft.type === "task" && (
            <label className="field">
              <span className="field-label">Project</span>
              <Select
                value={draft.workProjectId ?? ""}
                ariaLabel="Project"
                options={[
                  { value: "", label: "No project" },
                  ...workProjects
                    .filter((p) => !p.archivedAt)
                    .map((p) => ({ value: p.id, label: p.name })),
                ]}
                onChange={(v) => {
                  const project = workProjects.find((p) => p.id === v);
                  patch({
                    workProjectId: v || null,
                    // A parent from another project would make an invalid tree.
                    parentId: null,
                    ...(project?.calendarId && !draft.projectId
                      ? { projectId: project.calendarId }
                      : {}),
                  });
                }}
              />
            </label>
          )}
        </div>

        {draft.type === "task" && (
          <label className="field">
            <span className="field-label">Parent task</span>
            <Select
              value={draft.parentId ?? ""}
              ariaLabel="Parent task"
              options={[
                { value: "", label: "Top level" },
                ...items
                  .filter(
                    (i) =>
                      i.type === "task" &&
                      !i.deletedAt &&
                      i.id !== editor.itemId &&
                      !i.parentId &&
                      (!draft.workProjectId || i.workProjectId === draft.workProjectId),
                  )
                  .map((i) => ({ value: i.id, label: i.title })),
              ]}
              onChange={(v) => patch({ parentId: v || null })}
            />
          </label>
        )}

        <div className="field">
          <span className="field-label">Tags</span>
          <div className="tag-editor">
            {projectTags.map((tag) => (
              <span className="tag-chip" key={tag!.id}>
                #{tag!.name}
                <button
                  onClick={() =>
                    patch({ tagIds: (draft.tagIds ?? []).filter((id) => id !== tag!.id) })
                  }
                >
                  <X size={9} />
                </button>
              </span>
            ))}
            <input
              value={tagInput}
              placeholder="Add tag…"
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  void addTag(tagInput);
                }
              }}
              onBlur={() => {
                if (tagInput.trim()) void addTag(tagInput);
              }}
            />
          </div>
        </div>
          </>
        )}

        {/* Only events repeat. A task's repeats live on its time blocks above. */}
        {sectionVisible("schedule") && draft.type === "event" && (
          <div className="field">
            <span className="field-label">Repeat</span>
            <RecurrenceField
              value={draft.recurrence?.rrule ?? null}
              start={draft.start}
              onChange={(rrule) => patch({ recurrence: rrule ? { rrule } : null })}
            />
          </div>
        )}

        {sectionVisible("details") && (
        <div className="field">
          <span className="field-label">Reminders</span>
          <div className="sheet-row" style={{ flexWrap: "wrap", gap: 4 }}>
            {(draft.reminders ?? []).map((reminder) => (
              <span className="reminder-chip" key={reminder.id}>
                <Bell size={9} />
                {reminder.offsetMin === 0
                  ? "At time"
                  : `${reminder.offsetMin >= 60 ? `${reminder.offsetMin / 60}h` : `${reminder.offsetMin}m`} before`}
                <button
                  onClick={() =>
                    patch({
                      reminders: (draft.reminders ?? []).filter((r) => r.id !== reminder.id),
                    })
                  }
                >
                  <X size={9} />
                </button>
              </span>
            ))}
            <Select
              value=""
              placeholder="Add reminder…"
              ariaLabel="Add reminder"
              style={{ width: 130, flex: "none" }}
              options={REMINDER_PRESETS.map((preset) => ({
                value: String(preset.value),
                label: preset.label,
              }))}
              onChange={(v) => addReminder(Number(v))}
            />
          </div>
        </div>
        )}

        {sectionVisible("notes") && (
          <>
        <label className="field">
          <span className="field-label">Notes</span>
          <textarea
            value={draft.body ?? ""}
            placeholder="Details, links, what you need to remember…"
            onChange={(e) => patch({ body: e.target.value })}
            style={{ minHeight: draft.type === "note" ? 220 : 80 }}
          />
        </label>

        <label className="field">
          <span className="field-label">Link</span>
          <div className="sheet-row">
            <Link2 size={12} style={{ color: "var(--text-3)" }} />
            <input
              className="input"
              value={draft.url ?? ""}
              placeholder="https://…"
              onChange={(e) => patch({ url: e.target.value })}
            />
          </div>
        </label>
          </>
        )}
      </div>

      <div className="sheet-foot">
        {editor.itemId && (
          <div className="menu-anchor">
            <button
              className="btn danger"
              onClick={() => {
                if (isSeriesInstance) setDeleteMenu((v) => !v);
                else void remove("all");
              }}
            >
              <Trash2 size={12} /> Delete
            </button>
            {deleteMenu && (
              <div className="popover" style={{ bottom: 34, left: 0, width: 196 }}>
                <button className="menu-item" onClick={() => void remove("single")}>
                  This occurrence
                </button>
                <button className="menu-item" onClick={() => void remove("all")}>
                  All events
                </button>
              </div>
            )}
          </div>
        )}
        {editor.itemId && (
          <button className="icon-btn" title="Duplicate" onClick={() => void duplicate()}>
            <Copy size={13} />
          </button>
        )}
        <div className="spacer" />
        <span className="sheet-hint">⌘↵ to save</span>
        <button className="btn" onClick={closeEditor}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {editor.itemId ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );
}
