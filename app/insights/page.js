'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { analyzeBusiness, answerBusinessQuestion, QUICK_QUESTIONS } from '../../lib/businessIntelligence'

function SalesChart({ daily, forecast, currency }) {
  const history = daily.slice(-30)
  const prediction = forecast?.status === 'ready' ? forecast.daily : []
  const values = [...history, ...prediction]
  const max = Math.max(1, ...values.map(row => Number(row.sales)))
  const points = (rows, offset = 0) => rows.map((row, i) => `${40 + (i + offset) * 680 / Math.max(1, values.length - 1)},${190 - Number(row.sales) / max * 160}`).join(' ')
  return <figure className="mt-5">
    <svg viewBox="0 0 760 230" className="w-full" role="img" aria-label={`Daily net sales in ${currency}. Solid line: latest 30 complete days. Dashed line: estimated next 30 days when enough history exists.`}>
      <path d="M40 30V190H720" fill="none" stroke="currentColor" opacity=".15" />
      <polyline points={points(history)} fill="none" stroke="var(--accent, #1f4f8f)" strokeWidth="3" />
      {prediction.length > 0 && <polyline points={points([history.at(-1), ...prediction], history.length - 1)} fill="none" stroke="#0d9488" strokeWidth="3" strokeDasharray="6 5" />}
      <text x="40" y="218" fill="currentColor" fontSize="13">{history[0]?.date}</text>
      <text x="720" y="218" textAnchor="end" fill="currentColor" fontSize="13">{values.at(-1)?.date}</text>
    </svg>
    <figcaption className="text-xs text-muted">Solid: recorded sales · Dashed: forecast · Complete business days in your business timezone.</figcaption>
    <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">View daily values</summary>
      <div className="mt-2 max-h-52 overflow-auto"><table className="w-full text-left"><thead><tr><th className="p-2">Date</th><th>Net sales ({currency})</th><th>Type</th></tr></thead><tbody>{values.map((row, i) => <tr key={row.date}><td className="p-2">{row.date}</td><td>{Number(row.sales).toLocaleString()}</td><td>{i < history.length ? 'Recorded' : 'Estimated'}</td></tr>)}</tbody></table></div>
    </details>
  </figure>
}

export default function InsightsPage() {
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('get_business_insights').abortSignal(controller.signal)
        if (controller.signal.aborted) return
        if (rpcError) throw rpcError
        if (!data?.daily || !data?.access) throw new Error('Business insights are unavailable. Please try again.')
        setSnapshot(data)
      } catch (e) {
        if (!controller.signal.aborted) setError(e.message || 'Could not load business insights.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [attempt])
  const analysis = useMemo(() => snapshot ? analyzeBusiness(snapshot) : null, [snapshot])
  function refresh() {
    setLoading(true); setError(''); setSnapshot(null); setAsked(''); setAttempt(value => value + 1)
  }
  if (loading) return <main className="page-wrap text-muted" role="status">Analyzing your business...</main>
  if (error || !analysis) return <main className="page-wrap"><div className="page-card p-6" role="alert"><h1 className="page-title">MGT Intelligence</h1><p className="mt-4">{error || 'Business insights are unavailable.'}</p><button onClick={refresh} className="btn-primary mt-4 rounded-xl px-4 py-2">Try again</button></div></main>
  const m = value => `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${analysis.currency}`
  const f = analysis.forecast
  const answer = asked ? answerBusinessQuestion(asked, snapshot, analysis) : ''
  return <main className="page-wrap">
    <div className="page-header-row"><div><p className="page-eyebrow">Your business at a glance</p><h1 className="page-title">MGT Intelligence</h1><p className="page-subtitle">Find the changes that matter, plan ahead and get answers from your business data.</p></div><button onClick={refresh} className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-bold">Refresh insights</button></div>
    <p className="mb-5 text-xs text-muted">Updated {new Date(snapshot.generated_at).toLocaleString()} · Period: {snapshot.period_start} to {snapshot.period_end} · {snapshot.timezone}</p>
    <section className="page-card mb-5 p-5 sm:p-6">
      <h2 className="text-xl font-bold">Ask MGT</h2><p className="mt-1 text-sm text-muted">Quick answers about sales, forecasts, expenses, stock and priorities.</p>
      <form onSubmit={event => { event.preventDefault(); if (question.trim()) setAsked(question.trim()) }} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="business-question" className="sr-only">Your business question</label><input id="business-question" className="input-base min-w-0 flex-1" value={question} onChange={event => setQuestion(event.target.value)} maxLength={300} required placeholder="How are sales trending?" />
        <button className="btn-primary rounded-xl px-5 py-3 font-bold">Get answer</button>
      </form>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">{QUICK_QUESTIONS.map(q => <button key={q} onClick={() => { setQuestion(q); setAsked(q) }} className="rounded-full border border-[var(--line)] px-3 py-2 text-xs hover:bg-[var(--panel-2)]">{q}</button>)}</div>
      {answer && <div className="mt-4 whitespace-pre-line rounded-2xl bg-[var(--panel-2)] p-4 text-sm leading-7" role="status">{answer}</div>}
    </section>
    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ['Net sales · 30 days', analysis.sales === null ? 'Access restricted' : m(analysis.sales), analysis.growth === null ? 'No earlier non-zero baseline' : `${analysis.growth >= 0 ? '+' : ''}${analysis.growth.toFixed(1)}% vs previous 30 days`],
        ['Recorded expenses · 30 days', analysis.expenses === null ? 'Access restricted' : m(analysis.expenses), 'Recorded spending, not total business cost'],
        ['Outstanding sales balances', snapshot.sales_receivables === null ? 'Access restricted' : m(snapshot.sales_receivables), 'All sale dates; excludes opening balances, jobs and projects'],
        ['Products at reorder level', snapshot.inventory ? snapshot.inventory.low_count : 'Access restricted', 'Active tracked products, after reservations'],
      ].map(([label, value, detail]) => <article key={label} className="page-card p-4"><p className="text-xs text-muted">{label}</p><strong className="mt-2 block text-xl">{value}</strong><p className="mt-2 text-xs leading-5 text-muted">{detail}</p></article>)}
    </section>
    <section className="mb-5 grid items-start gap-5 xl:grid-cols-2">
      <div className="page-card p-5 sm:p-6"><h2 className="text-xl font-bold">Sales outlook</h2>
        {!f ? <p className="mt-3 text-sm text-muted">Sales insights require sales access and an enabled sales module.</p> : f.status !== 'ready' ? <p className="mt-3 text-sm leading-6 text-muted">{f.message} Available history: {f.days} complete days, including {f.activeDays} days with sales.</p> : <>
          <p className="mt-3 text-xs text-muted">Estimated next 30 days · {f.from} to {f.through}</p><strong className="mt-2 block text-3xl">{m(f.total)}</strong>
          <p className="mt-3 text-sm text-muted">{f.label}</p><p className="mt-2 text-xs leading-5 text-muted">Learned from {f.trainingDays} complete days. Mean daily error in the recent {f.validationDays}-day check: {m(f.dailyError)}. Estimates can change with demand, pricing and business conditions.</p>
        </>}
        {snapshot.access.sales && <SalesChart daily={snapshot.daily} forecast={f} currency={analysis.currency} />}
      </div>
      <div className="page-card p-5 sm:p-6"><h2 className="text-xl font-bold">Management priorities</h2>
        {!analysis.signals.length && <p className="mt-4 text-sm leading-6 text-muted">No priority signals were found in the records you can access. Review reports and history coverage for a fuller picture.</p>}
        <div className="mt-4 space-y-3">{analysis.signals.map(item => <article key={item.id} className="rounded-2xl border border-[var(--line)] p-4"><p className={`mb-1 text-xs font-bold uppercase ${item.severity === 'attention' ? 'text-amber-600' : 'text-teal-600'}`}>{item.severity}</p><h3 className="font-bold">{item.title}</h3><p className="mt-2 text-sm leading-6 text-muted">{item.detail}</p><Link className="mt-3 inline-block text-sm font-bold text-accent" href={item.href}>Review records →</Link></article>)}</div>
      </div>
    </section>
    <details className="page-card p-5 text-sm text-muted"><summary className="cursor-pointer font-bold text-[var(--text)]">About these insights</summary><div className="mt-3 space-y-3 leading-6">
      <p>MGT analyzes up to 90 complete days in your business timezone. Net sales include tax and deduct refunds from the original sale date. Today’s partial day is excluded from period totals and model training. Outstanding sales balances include all sale dates.</p>
      <p>The forecast compares a learned trend and weekday model with recent weekday and daily averages using the latest 14 complete days, then fits the best performer to the available history. Its recent error is a useful check, not a guarantee of future accuracy.</p>
      <p>Quick answers use this snapshot and supported question topics. They do not run commands or change records. Only data allowed by your permissions and enabled modules is included. Your records stay within your MGT application and database.</p>
    </div></details>
  </main>
}
