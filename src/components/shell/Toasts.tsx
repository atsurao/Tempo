import { useEffect } from "react";
import { X } from "lucide-react";
import { useUI, type Toast } from "../../store/ui";

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useUI((s) => s.dismissToast);

  useEffect(() => {
    const id = window.setTimeout(() => dismiss(toast.id), toast.action ? 7000 : 3800);
    return () => window.clearTimeout(id);
  }, [toast.id, toast.action, dismiss]);

  return (
    <div className="toast" data-tone={toast.tone ?? "default"}>
      <span className="toast-msg">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action?.();
            dismiss(toast.id);
          }}
        >
          {toast.actionLabel ?? "Undo"}
        </button>
      )}
      <button className="icon-btn" style={{ width: 18, height: 18 }} onClick={() => dismiss(toast.id)}>
        <X size={11} />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
