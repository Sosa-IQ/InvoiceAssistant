export default function PageLoading() {
  return (
    <div role="status" aria-live="polite" className="grid min-h-48 place-items-center text-sm text-muted-foreground">
      <span className="sr-only">Loading page</span>
      <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  )
}
