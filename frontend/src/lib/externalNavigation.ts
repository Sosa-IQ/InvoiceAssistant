export function redirectToStripe(rawUrl: string): void {
  const url = new URL(rawUrl)
  const isStripeHost = url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com")
  if (url.protocol !== "https:" || !isStripeHost) {
    throw new Error("Refusing to navigate to an untrusted billing URL.")
  }
  window.location.assign(url.toString())
}
