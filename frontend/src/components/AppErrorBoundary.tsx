import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ui_error_boundary", {
      exceptionType: error.name,
      componentStackPresent: Boolean(info.componentStack),
    })
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <main className="grid min-h-dvh place-items-center bg-background px-6 text-foreground">
        <section role="alert" aria-labelledby="app-error-title" className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 id="app-error-title" className="text-xl font-semibold">Invoice Assistant needs a reset</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your saved invoices are unaffected. Reload the application to continue.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Reload application
          </button>
        </section>
      </main>
    )
  }
}
