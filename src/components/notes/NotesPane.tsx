import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, CalendarClock, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useItems } from "../../db/hooks";
import { useUI } from "../../store/ui";
import { createItem, restoreSubtree, softDeleteItem, updateItem } from "../../db/db";
import { renderMarkdown } from "../../lib/markdown";
import { draftFromItem } from "../../lib/draft";
import { clockTime } from "../../lib/clock";
import { useTimeFormat } from "../../hooks/useTimeFormat";
import type { Item } from "../../types";

export function NotesPane() {
  const items = useItems();
  const openEdit = useUI((s) => s.openEdit);
  const toast = useUI((s) => s.toast);
  const timeFormat = useTimeFormat();

  const notes = useMemo(
    () =>
      items
        .filter((i) => i.type === "note" && !i.deletedAt)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [items],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    setTitle(selected?.title ?? "");
    setBody(selected?.body ?? "");
    setPreview(false);
  }, [selected?.id]);

  // debounced autosave; compare against what will actually be written, or a
  // blank title would never match the stored fallback and save forever
  useEffect(() => {
    if (!selected) return;
    const nextTitle = title.trim() ? title : "Untitled note";
    if (nextTitle === selected.title && body === selected.body) return;
    const id = window.setTimeout(() => {
      void updateItem(selected.id, { title: nextTitle, body });
    }, 500);
    return () => window.clearTimeout(id);
  }, [title, body, selected]);

  const newNote = async () => {
    const note = await createItem({ type: "note", title: "Untitled note", body: "" });
    setSelectedId(note.id);
  };

  const dailyNote = async () => {
    const label = `Daily — ${format(Date.now(), "MMM d, yyyy")}`;
    const existing = notes.find((n) => n.title.startsWith(label));
    if (existing) {
      setSelectedId(existing.id);
      return;
    }
    const note = await createItem({
      type: "note",
      title: label,
      body: `# ${format(Date.now(), "EEEE, MMMM d")}\n\n## What went well\n\n## What slipped\n\n## Top 3 for tomorrow\n\n1. \n2. \n3. `,
    });
    setSelectedId(note.id);
    toast("Daily note created");
  };

  if (selected) {
    return (
      <div className="note-editor">
        <div className="note-editor-head">
          <button className="icon-btn" title="Back to notes" onClick={() => setSelectedId(null)}>
            <ArrowLeft size={14} />
          </button>
          <input
            className="note-editor-title"
            value={title}
            placeholder="Note title"
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            className="icon-btn"
            data-active={preview}
            title={preview ? "Edit" : "Preview"}
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? <Pencil size={13} /> : <Eye size={13} />}
          </button>
          <button
            className="icon-btn"
            title="Open full editor"
            onClick={() => openEdit(selected.id, draftFromItem(selected))}
          >
            <CalendarClock size={13} />
          </button>
          <button
            className="icon-btn"
            title="Delete note"
            onClick={async () => {
              await softDeleteItem(selected.id);
              setSelectedId(null);
              toast("Note deleted", {
                actionLabel: "Undo",
                action: () => void restoreSubtree(selected.id),
              });
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
        <div className="note-body">
          {preview ? (
            <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
          ) : (
            <textarea
              className="note-textarea"
              value={body}
              placeholder="# Start writing…&#10;&#10;- [ ] a task in a note&#10;- **bold** and *italic*"
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="notes">
      <div className="notes-toolbar">
        <button className="btn sm" onClick={() => void newNote()}>
          <Plus size={12} /> New note
        </button>
        <button className="btn sm subtle" onClick={() => void dailyNote()}>
          <CalendarClock size={12} /> Daily note
        </button>
      </div>
      <div className="notes-list">
        {notes.length === 0 && (
          <div className="empty">
            <strong>No notes yet</strong>
            Capture a lecture, a reading summary, or a weekly review.
          </div>
        )}
        {notes.map((note) => (
          <button
            key={note.id}
            className="note-item"
            data-active={note.id === selectedId}
            onClick={() => setSelectedId(note.id)}
          >
            <div className="note-title">{note.title || "Untitled note"}</div>
            <div className="note-snippet">{plainPreview(note)}</div>
            <div className="note-date">
              {format(note.updatedAt, "MMM d")}, {clockTime(note.updatedAt, timeFormat)}
              {note.projectId ? "" : ""}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function plainPreview(note: Item): string {
  const text = (note.body ?? "")
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n+/g, " ")
    .trim();
  return text.slice(0, 140) || "Empty note";
}
