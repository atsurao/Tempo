import { TriangleAlert } from "lucide-react";
import { useUI } from "../../store/ui";

/**
 * One shell-level yes/no dialog. Destructive actions go through the store so
 * the question survives the menu or pane that asked it closing.
 */
export function ConfirmDialog() {
  const request = useUI((s) => s.confirm);
  const close = useUI((s) => s.closeConfirm);
  if (!request) return null;

  const run = () => {
    close();
    request.onConfirm();
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={request.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-head">
          <span className="confirm-icon" data-danger={request.danger || undefined}>
            <TriangleAlert size={15} />
          </span>
          <div>
            <div className="modal-title">{request.title}</div>
            {request.body && <p className="confirm-body">{request.body}</p>}
          </div>
        </div>
        <div className="confirm-foot">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className={`btn primary${request.danger ? " danger-fill" : ""}`}
            autoFocus
            onClick={run}
          >
            {request.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
