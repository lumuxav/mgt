'use client'

export default function GlobalError({ reset }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f4f6fa', color: '#111827' }}>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <section style={{ width: 'min(100%, 520px)', background: '#fff', borderRadius: 24, padding: 28, boxShadow: '0 10px 35px rgba(15,23,42,.08)', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, margin: '0 auto 16px', borderRadius: 16, display: 'grid', placeItems: 'center', background: '#dbeafe', color: '#1f4f8f', fontWeight: 900 }}>MGT</div>
            <h1 style={{ margin: 0, fontSize: 26 }}>MGT needs to reload</h1>
            <p style={{ margin: '10px 0 0', lineHeight: 1.6, color: '#64748b' }}>A page-level failure occurred. Reload the application before repeating any transaction.</p>
            <button onClick={() => reset()} style={{ marginTop: 20, border: 0, borderRadius: 12, padding: '12px 18px', background: '#1f4f8f', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Reload MGT</button>
          </section>
        </main>
      </body>
    </html>
  )
}
