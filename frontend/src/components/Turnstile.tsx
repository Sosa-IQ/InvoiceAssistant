import { useEffect, useRef } from "react"
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile"

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      "expired-callback": () => void
      "error-callback": () => void
      theme?: "auto" | "light" | "dark"
    },
  ) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script")
      script.src = SCRIPT_SRC
      script.async = true
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile unavailable")))
      script.onerror = () => {
        scriptPromise = null
        reject(new Error("Could not load Turnstile"))
      }
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

/**
 * Renders the Turnstile challenge and reports its token (or null when it expires or fails).
 * Tokens are single-use: remount with a new `key` after each submit to get a fresh one.
 * `onToken` should be stable (e.g. a state setter); a new function re-renders the widget.
 */
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let widgetId: string | null = null
    let cancelled = false
    onToken(null)

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return
        widgetId = turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "light",
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        })
      })
      .catch(() => onToken(null))

    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [onToken])

  return <div ref={containerRef} className="min-h-[65px]" />
}
