import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Last line of defence. Renders in the same room the app lives in. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[phaedrus]', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boundary">
        <p className="label boundary-label">The needle skipped</p>
        <h1 className="boundary-title">Something came off the rails.</h1>
        <p className="boundary-detail">{this.state.error.message}</p>
        <button type="button" className="boundary-btn" onClick={() => window.location.reload()}>
          Lift and drop
        </button>
      </div>
    );
  }
}
