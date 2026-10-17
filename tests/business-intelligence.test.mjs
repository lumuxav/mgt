import test from 'node:test'
import assert from 'node:assert/strict'
import { forecastSales, analyzeBusiness, answerBusinessQuestion } from '../lib/businessIntelligence.js'

const series = (count, value = () => 100) => Array.from({ length: count }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), sales: value(i), expenses: 10 }))
const snapshot = daily => ({ currency: 'UGX', access: { sales: true, finance: true }, daily, first_sale_date: daily[0]?.date, sales_receivables: 500, inventory: null, operations: {} })

test('learns a trend and projects future dates, without copying the last month', () => {
  const rows = series(90, i => 100 + 2 * i)
  const f = forecastSales(rows, rows[0].date)
  assert.equal(f.status, 'ready'); assert.equal(f.model, 'ridge')
  const actual = Array.from({ length: 30 }, (_, i) => 100 + 2 * (90 + i)).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(f.total - actual) / actual < 0.02)
  assert.equal(f.from, '2026-04-01'); assert.equal(f.through, '2026-04-30')
  assert.ok(f.dailyError < 2)
})

test('uses weekday evidence and selects an accurate seasonal forecast', () => {
  const values = [0, 200, 400, 150, 100, 300, 600]
  const rows = series(90, i => values[new Date(Date.UTC(2026, 0, i + 1)).getUTCDay()])
  const f = forecastSales(rows, rows[0].date)
  assert.equal(f.status, 'ready'); assert.equal(f.model, 'weekday'); assert.equal(f.dailyError, 0)
  for (const row of f.daily) assert.equal(row.sales, values[new Date(row.date + 'T00:00:00Z').getUTCDay()])
})

test('does not manufacture history for a new or inactive business', () => {
  const rows = series(90)
  assert.equal(forecastSales(rows, rows[70].date).status, 'insufficient_history')
  assert.equal(forecastSales(rows, null).status, 'insufficient_history')
  assert.equal(forecastSales(series(90, () => 0), rows[0].date).status, 'insufficient_history')
  assert.equal(forecastSales(series(90, i => i < 10 ? 100 : 0), rows[0].date).status, 'insufficient_history')
})

test('rejects gaps, unordered dates, non-finite values and invalid horizons', () => {
  const rows = series(90)
  assert.throws(() => forecastSales(rows.filter((_, i) => i !== 40), rows[0].date), /complete/)
  assert.throws(() => forecastSales([...rows].reverse(), rows[0].date), /ordered/)
  rows[30].sales = Infinity
  assert.throws(() => forecastSales(rows, rows[0].date), /finite/)
  assert.throws(() => forecastSales([], null, 365), /horizon/)
})

test('measures unseen days chronologically and reports errors after a demand shock', () => {
  const rows = series(90, i => i < 76 ? 100 : 200)
  const f = forecastSales(rows, rows[0].date)
  assert.equal(f.dailyError, 100)
  assert.equal(f.validationDays, 14)
  assert.equal(f.trainingDays, 90)
  assert.ok(f.daily.every(row => Number.isFinite(row.sales) && row.sales >= 0))
})

test('period totals and questions use the same snapshot and precise metric scope', () => {
  const s = snapshot(series(90, i => i < 60 ? 100 : 200))
  const a = analyzeBusiness(s)
  assert.equal(a.sales, 6000); assert.equal(a.previousSales, 3000); assert.equal(a.growth, 100)
  assert.equal(a.expenses, 300)
  assert.match(answerBusinessQuestion('How are sales trending?', s, a), /100.0% higher/)
  assert.match(answerBusinessQuestion('How much is owed?', s, a), /500 UGX/)
  assert.match(answerBusinessQuestion('What is the forecast?', s, a), /Estimated net sales/)
  assert.match(answerBusinessQuestion('Delete all sales', s, a), /Net sales were/)
  assert.match(answerBusinessQuestion('What is the weather?', s, a), /Ask about sales trends/)
})

test('restricted data stays unavailable and zero history is not called healthy', () => {
  const s = snapshot(series(90, () => 0))
  s.access = { sales: false, finance: false }; s.sales_receivables = null
  const a = analyzeBusiness(s)
  assert.equal(a.sales, null); assert.equal(a.expenses, null); assert.equal(a.forecast, null)
  assert.equal(a.signals.length, 0)
  for (const question of ['sales trend', 'expenses', 'forecast', 'stock', 'owed']) assert.match(answerBusinessQuestion(question, s, a), /outside your/)
  assert.match(answerBusinessQuestion('What needs attention?', s, a), /data you can access/)
})

test('computes stock and operational priorities from allowed counts', () => {
  const s = snapshot(series(90))
  s.inventory = { low_count: 1, low_items: [{ name: 'Bolts', available: 4, reorder_level: 10 }] }
  s.operations = { overdue_jobs: 2, over_budget_projects: 1 }
  const a = analyzeBusiness(s)
  assert.match(answerBusinessQuestion('What needs restocking?', s, a), /Bolts: 4 available/)
  assert.ok(a.signals.some(row => row.id === 'jobs'))
  assert.ok(a.signals.some(row => row.id === 'projects'))
})
