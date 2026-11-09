import { useState } from "react";
import { X } from "lucide-react";
import { useUI, type PaneRef } from "../../store/ui";

interface Props {
  pane: PaneRef;
  title: string;
  icon: React.ReactNode;
  actions?: React.ReactNode;
  canRemove: boolean;
  children: React.ReactNode;
}

export function PaneFrame({ pane, title, icon, actions, canRemove, children }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(title);
  const setPaneTitle = useUI((s) => s.setPaneTitle);
  const removePane = useUI((s) => s.removePane);

  return (
    <section className="pane" style={{ flexGrow: pane.size }}>
      <header className="pane-head">
        <div
          className="pane-title"
          onDoubleClick={() => {
            setValue(pane.title ?? title);
            setRenaming(true);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setValue(pane.title ?? title);
            setRenaming(true);
          }}
          title="Double-click or long-press to rename"
        >
          {icon}
          {renaming ? (
            <input
              className="input bare"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => {
                setRenaming(false);
                setPaneTitle(pane.id, value.trim());
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setRenaming(false);
                  setPaneTitle(pane.id, value.trim());
                }
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <span>{pane.title || title}</span>
          )}
        </div>
        <div className="spacer" />
        <div className="pane-actions">
          {actions}
          {canRemove && (
            <button
              className="icon-btn"
              title="Close pane"
              onClick={() => removePane(pane.id)}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </header>
      <div className="pane-body">{children}</div>
    </section>
  );
}
