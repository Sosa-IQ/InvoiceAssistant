/** Case-insensitive match of every search word against any of the given fields. */
export function matchesSearch(query: string, fields: Array<string | null | undefined>): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fields.filter(Boolean).join(" ").toLowerCase()
  return words.every((word) => haystack.includes(word))
}
