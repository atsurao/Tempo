import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence. A render error anywhere in the tree otherwise unmounts
 * the whole window and leaves a blank app; here it costs one recoverable
 * screen instead, and the message survives for a bug report.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Tempo stopped rendering:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash" role="alert">
        <div className="crash-card">
          <div className="crash-title">Tempo hit a snag</div>
          <p className="crash-text">
            Something went wrong while drawing this view. Everything you have saved stays on this
            device.
          </p>
          <pre className="crash-detail">{error.message}</pre>
          <div className="crash-actions">
            <button className="btn" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button className="btn primary" onClick={() => window.location.reload()}>
              Reload Tempo
            </button>
          </div>
        </div>
      </div>
    );
  }
}
