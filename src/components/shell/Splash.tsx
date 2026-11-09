import { useCallback, useEffect, useRef, useState } from "react";
import { BrandMark } from "./AppBar";
import { VERSION_LABEL } from "../../lib/version";
import { setShowSplash } from "../../lib/appSettings";

/** Long enough to read two lines, short enough to stay out of the way. */
const HOLD_MS = 3_400;

/**
 * The launch card: what Tempo is and which build this is. Any click or key
 * dismisses it early, and it can be switched off here or in Settings.
 */
export function Splash({ onClose }: { onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const gone = useRef(false);
  const closeTimer = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (gone.current) return;
    gone.current = true;
    setLeaving(true);
    closeTimer.current = window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    const timer = window.setTimeout(dismiss, HOLD_MS);
    const onKey = () => dismiss();
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      window.removeEventListener("keydown", onKey);
    };
  }, [dismiss]);

  return (
    <div
      className="splash"
      data-leaving={leaving}
      role="dialog"
      aria-label="Welcome to Tempo"
      onMouseDown={dismiss}
    >
      <div className="splash-card">
        <div className="splash-mark">
          <BrandMark />
        </div>
        <div className="splash-name">Tempo</div>
        <p className="splash-line">
          A calm, local-first day planner — calendar, tasks, notes and habits in one quiet
          window.
        </p>
        <div className="splash-meta">
          <span className="splash-version">{VERSION_LABEL}</span>
          <span className="splash-sep" />
          <span>Everything stays on this device</span>
        </div>
      </div>

      <div className="splash-foot" onMouseDown={(e) => e.stopPropagation()}>
        <button
          className="btn sm"
          onClick={() => {
            void setShowSplash(false);
            dismiss();
          }}
        >
          Don't show again
        </button>
        <button className="btn sm primary" onClick={dismiss}>
          Continue
        </button>
      </div>

      {!leaving && <span className="splash-timer" aria-hidden />}
    </div>
  );
}
