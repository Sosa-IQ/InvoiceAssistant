import * as Sentry from "@sentry/react"

/** Strip query strings and fragments: recovery links carry auth tokens in the URL fragment. */
export function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url
  return url.replace(/[?#].*$/, "")
}

type ScrubbableEvent = {
  request?: { url?: string; query_string?: unknown; cookies?: unknown; headers?: unknown; data?: unknown }
  user?: unknown
  breadcrumbs?: Array<{ category?: string; data?: Record<string, unknown> }>
}

/** Mirror of the backend scrubber: no user identity, request bodies, headers, or URL secrets. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    event.request.url = scrubUrl(event.request.url)
    delete event.request.query_string
    delete event.request.cookies
    delete event.request.headers
    delete event.request.data
  }
  delete event.user
  if (event.breadcrumbs) {
    // Console output can include invoice or client data, so drop it entirely.
    event.breadcrumbs = event.breadcrumbs.filter((crumb) => crumb.category !== "console")
    for (const crumb of event.breadcrumbs) {
      const data = crumb.data
      if (!data) continue
      for (const key of ["url", "from", "to"]) {
        if (typeof data[key] === "string") data[key] = scrubUrl(data[key] as string)
      }
    }
  }
  return event
}

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    sendDefaultPii: false,
    // Errors only: no performance tracing or session replay.
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
  })
}

export { Sentry }
