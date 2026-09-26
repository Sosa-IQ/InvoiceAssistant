/** Cloudflare Turnstile site key. When unset, CAPTCHA is off (local dev without a widget). */
export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ""
