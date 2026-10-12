export default function Loading() {
  return (
    <main className="page-wrap" role="status" aria-live="polite" aria-busy="true">
      <p className="text-sm font-bold text-muted">Opening workspace...</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((item) => <div key={item} className="page-card h-28 bg-[var(--panel-2)]" />)}
      </div>
    </main>
  )
}
