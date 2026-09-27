/** Placeholders Cuenvia fills in when composing an invoice email. */
export const EMAIL_TEMPLATE_PLACEHOLDERS = [
  "{invoice_number}",
  "{client_name}",
  "{business_name}",
  "{issue_date}",
  "{total}",
  "{currency}",
]

/**
 * Brace groups that are not a known placeholder (e.g. "{foo}", "{ total }"). They are sent as
 * typed, which is fine when intended, so callers warn rather than block.
 */
export function unknownPlaceholders(template: string | null | undefined): string[] {
  if (!template) return []
  const found = template.match(/\{[^{}\n]*\}/g) ?? []
  return [...new Set(found.filter((group) => !EMAIL_TEMPLATE_PLACEHOLDERS.includes(group)))]
}
