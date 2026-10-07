'use client'

export default function Error({ error, reset }) {
  return (
    <main className="page-wrap flex min-h-[70vh] items-center justify-center">
      <div className="page-card max-w-lg p-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-xl font-black text-red-500">!</div>
        <h1 className="text-2xl font-black">Something went wrong</h1>
        <p className="mt-2 text-sm leading-6 text-muted">MGT could not finish loading this screen. Your business data has not been deliberately changed by this error.</p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={() => reset()} className="btn-primary rounded-xl px-4 py-2.5 text-sm font-black">Try again</button>
          <button type="button" onClick={() => window.location.assign('/')} className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-black">Home</button>
        </div>
        {process.env.NODE_ENV === 'development' && error?.message && <pre className="mt-4 overflow-auto rounded-xl bg-[var(--panel-2)] p-3 text-left text-xs">{error.message}</pre>}
      </div>
    </main>
  )
}
