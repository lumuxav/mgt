import Link from 'next/link'

export default function OfflinePage() {
  return (
    <main className="page-wrap flex min-h-[70vh] items-center justify-center">
      <div className="page-card max-w-md p-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-2)] text-xl font-black text-accent">MGT</div>
        <h1 className="text-2xl font-black">You’re offline</h1>
        <p className="mt-2 text-sm leading-6 text-muted">MGT Business Suite needs an internet connection to safely load live business, stock, finance and user data.</p>
        <Link href="/" className="btn-primary mt-5 inline-flex rounded-xl px-4 py-2.5 text-sm font-black">Try again</Link>
      </div>
    </main>
  )
}
