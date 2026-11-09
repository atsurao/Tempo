import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { APP_VERSION } from "../../lib/version";

interface Props {
  onClose: () => void;
}

/**
 * The app-identity card is mounted outside the top bar. The top bar uses a
 * backdrop filter and establishes its own stacking context on iOS; keeping
 * the card inside it lets pane headers and calendar layers paint over a fixed
 * child. A portal into the app shell keeps it above every page, while the
 * transparent scrim makes an outside tap close it without activating the UI
 * underneath.
 */
export function AboutPopover({ onClose }: Props) {
  const host = typeof document === "undefined" ? null : document.querySelector(".app");
  if (!host) return null;

  return createPortal(
    <div className="about-layer">
      <button
        className="about-scrim"
        aria-label="Close About Tempo"
        tabIndex={-1}
        onClick={onClose}
      />
      <div className="about-popover" role="dialog" aria-label="About Tempo">
        <button className="icon-btn about-close" onClick={onClose} title="Close" aria-label="Close">
          <X size={13} />
        </button>

        <div className="about-head">
          <img className="about-icon" src="/app-icon.png" width={52} height={52} alt="" />
          <div>
            <div className="about-name">Tempo</div>
            <div className="about-version">Version {APP_VERSION}</div>
          </div>
        </div>

        <p className="about-tagline">
          A calm, local-first day planner for calendar, tasks, notes and focus.
        </p>

        <div className="about-tags">
          <span className="about-tag">Local-first</span>
          <span className="about-tag">Mac + iPhone</span>
        </div>

        <div className="about-meta">
          <span>Copyright © 2026 Tempo</span>
          <span>MIT License</span>
        </div>
      </div>
    </div>,
    host,
  );
}
