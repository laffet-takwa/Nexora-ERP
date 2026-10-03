import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Catches render-time failures so an unexpected payload from the API cannot
 * white-screen the whole application. Without this, any unguarded property access
 * on a null field leaves the user with a blank page and no way forward.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The project has no client-side logging yet; console keeps the stack
    // available instead of swallowing it.
    console.error('Unhandled UI error', error, info.componentStack)
  }

  private readonly reload = () => window.location.reload()

  render(): ReactNode {
    const { error } = this.state

    if (!error) return this.props.children

    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <h1>Something went wrong</h1>
          <p>
            The application ran into an unexpected problem and stopped rendering this view. Your data has not
            been changed.
          </p>
          <pre className="error-boundary-detail">{error.message}</pre>
          <div className="error-boundary-actions">
            <button type="button" className="primary-button" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button type="button" className="secondary-button" onClick={this.reload}>
              Reload the page
            </button>
          </div>
        </div>
      </div>
    )
  }
}