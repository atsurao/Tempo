import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/calendar.css";
import "./styles/tasks.css";
import "./styles/habits.css";
import "./styles/projects.css";
import "./styles/goals.css";
import "./styles/panels.css";
import "./styles/editor.css";
import "./styles/context.css";
import "./styles/welcome.css";
import "./styles/mobile.css";
import "./styles/additions.css";
import "./styles/motion.css";
import App from "./App";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import { requestPersistentStorage } from "./lib/desktop";
import { installAutoBackup } from "./lib/autoBackup";
import { installAutoSync } from "./lib/sync/autoSync";

// Before the first query opens the database: watch every write so automatic
// backups and sync see each change, including the ones setup makes.
installAutoBackup();
installAutoSync();

// Set an initial theme before paint to avoid a flash.
document.documentElement.dataset.theme = window.matchMedia("(prefers-color-scheme: dark)").matches
  ? "dark"
  : "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Ask the webview to keep the local database instead of treating it as
// disposable site data. Harmless where the API is missing or refused.
requestPersistentStorage();

// Geometry checks for development only; the production build drops this branch.
if (import.meta.env.DEV) {
  void import("./dev/uiProbe").then(({ installProbe }) => installProbe());
  // The store on `window`, so a dev can ask what a click actually changed.
  void import("./store/ui").then(({ useUI }) => {
    (window as unknown as { __tempoUI?: unknown }).__tempoUI = useUI;
  });
}
