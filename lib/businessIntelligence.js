// Small per-business models, fitted in memory. No records leave the application.
const DAY = 86400000
const sum = values => values.reduce((a, b) => a + b, 0)
const mean = values => values.length ? sum(values) / values.length : 0
const plural = (count, singular, multiple = singular + 's') => count === 1 ? singular : multiple
const round = value => Math.round(value * 100) / 100
const money = (value, currency) => `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency}`
const stamp = date => Date.parse(`${date}T00:00:00Z`)

function features(date, origin) {
  const weekday = new Date(stamp(date)).getUTCDay()
  return [1, (stamp(date) - origin) / DAY / 30, ...Array.from({ length: 6 }, (_, i) => Number(weekday === i + 1))]
}

// Pivoted elimination solves the eight-coefficient ridge normal equations.
function solve(matrix, target) {
  const a = matrix.map((row, i) => [...row, target[i]])
  for (let col = 0; col < target.length; col++) {
    let pivot = col
    for (let i = col + 1; i < target.length; i++) if (Math.abs(a[i][col]) > Math.abs(a[pivot][col])) pivot = i
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    const divisor = a[col][col]
    if (Math.abs(divisor) < 1e-12) throw new Error('Insufficient independent observations')
    for (let j = col; j <= target.length; j++) a[col][j] /= divisor
    for (let i = 0; i < target.length; i++) if (i !== col) {
      const factor = a[i][col]
      for (let j = col; j <= target.length; j++) a[i][j] -= factor * a[col][j]
    }
  }
  return a.map(row => row[target.length])
}

function fitRidge(rows) {
  const origin = stamp(rows[0].date)
  const scale = mean(rows.map(row => row.sales)) || 1
  const matrix = Array.from({ length: 8 }, () => Array(8).fill(0))
  const target = Array(8).fill(0)
  for (const row of rows) {
    const x = features(row.date, origin)
    for (let i = 0; i < 8; i++) {
      target[i] += x[i] * row.sales / scale
      for (let j = 0; j < 8; j++) matrix[i][j] += x[i] * x[j]
    }
  }
  for (let i = 1; i < 8; i++) matrix[i][i] += 0.1
  const coefficients = solve(matrix, target)
  return date => Math.max(0, sum(features(date, origin).map((x, i) => x * coefficients[i])) * scale)
}

const candidates = [
  { id: 'ridge', label: 'Learned trend and weekday model', fit: fitRidge },
  { id: 'weekday', label: 'Recent weekday averages', fit: rows => {
    const recent = rows.slice(-28)
    const fallback = mean(recent.map(row => row.sales))
    const averages = Array.from({ length: 7 }, (_, day) => {
      const values = recent.filter(row => new Date(stamp(row.date)).getUTCDay() === day).map(row => row.sales)
      return values.length ? mean(values) : fallback
    })
    return date => averages[new Date(stamp(date)).getUTCDay()]
  } },
  { id: 'average', label: 'Recent daily average', fit: rows => {
    const average = mean(rows.slice(-28).map(row => row.sales))
    return () => average
  } },
]

export function forecastSales(daily, firstSaleDate, horizon = 30) {
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 30) throw new Error('Forecast horizon must be 1–30 days')
  if (!Array.isArray(daily)) throw new Error('Daily sales are unavailable')
  const rows = daily.filter(row => firstSaleDate && row.date >= firstSaleDate).map(row => ({ date: row.date, sales: Number(row.sales) }))
  for (let i = 0; i < rows.length; i++) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rows[i].date) || !Number.isFinite(stamp(rows[i].date)) || !Number.isFinite(rows[i].sales) || rows[i].sales < 0 || (i > 0 && stamp(rows[i].date) - stamp(rows[i - 1].date) !== DAY)) {
      throw new Error('Daily sales history must be complete, ordered and finite')
    }
  }
  const activeDays = rows.filter(row => row.sales > 0).length
  if (rows.length < 56 || activeDays < 14) return {
    status: 'insufficient_history', days: rows.length, activeDays,
    message: 'A forecast needs at least 56 complete days since the first sale and 14 days with sales.',
  }
  const training = rows.slice(0, -14)
  const validation = rows.slice(-14)
  const scores = candidates.map(candidate => {
    const predict = candidate.fit(training)
    return { ...candidate, mae: mean(validation.map(row => Math.abs(row.sales - predict(row.date)))) }
  }).sort((a, b) => a.mae - b.mae)
  const selected = scores[0]
  const predict = selected.fit(rows)
  const last = stamp(rows.at(-1).date)
  const prediction = Array.from({ length: horizon }, (_, i) => {
    const date = new Date(last + DAY * (i + 1)).toISOString().slice(0, 10)
    return { date, sales: round(predict(date)) }
  })
  return {
    status: 'ready', model: selected.id, label: selected.label, trainingDays: rows.length, activeDays,
    validationDays: 14, dailyError: round(selected.mae), total: round(sum(prediction.map(row => row.sales))),
    from: prediction[0].date, through: prediction.at(-1).date, daily: prediction,
    candidates: scores.map(({ id, mae }) => ({ model: id, dailyError: round(mae) })),
  }
}

export function analyzeBusiness(snapshot) {
  const currency = snapshot.currency || 'UGX'
  const current = snapshot.daily.slice(-30)
  const previous = snapshot.daily.slice(-60, -30)
  const total = (rows, key) => sum(rows.map(row => Number(row[key] || 0)))
  const sales = snapshot.access.sales ? total(current, 'sales') : null
  const previousSales = snapshot.access.sales ? total(previous, 'sales') : null
  const expenses = snapshot.access.finance ? total(current, 'expenses') : null
  const previousExpenses = snapshot.access.finance ? total(previous, 'expenses') : null
  const growth = previousSales > 0 ? (sales - previousSales) / previousSales * 100 : null
  const forecast = snapshot.access.sales ? forecastSales(snapshot.daily, snapshot.first_sale_date) : null
  const signals = []
  const add = (id, severity, title, detail, href) => signals.push({ id, severity, title, detail, href })
  if (growth !== null && growth <= -15) add('sales', 'attention', 'Sales are down', `Net sales fell ${Math.abs(growth).toFixed(1)}% from the previous 30 complete days. Review your sales report to locate the change.`, '/sales-report')
  if (growth !== null && growth >= 15) add('growth', 'opportunity', 'Sales are growing', `Net sales rose ${growth.toFixed(1)}%. Check stock availability for your strongest products.`, '/sales-report')
  if (snapshot.inventory?.low_count > 0) add('stock', 'attention', `${snapshot.inventory.low_count} ${plural(snapshot.inventory.low_count, 'product needs', 'products need')} stock attention`, 'Available stock is at or below the reorder level. Review quantities and outstanding purchases before ordering.', '/inventory')
  if (snapshot.sales_receivables > 0) add('collections', 'attention', 'Sales balances are outstanding', `${money(snapshot.sales_receivables, currency)} remains due on recorded sales, including older sales. Customer opening balances, service jobs and project invoices are separate.`, '/customers')
  if (previousExpenses > 0 && expenses > previousExpenses * 1.2) add('expenses', 'attention', 'Expenses have increased', `Recorded expenses are ${((expenses - previousExpenses) / previousExpenses * 100).toFixed(1)}% above the previous 30 complete days. Review the largest expense categories.`, '/cashbook')
  if (snapshot.operations?.overdue_jobs > 0) add('jobs', 'attention', `${snapshot.operations.overdue_jobs} ${plural(snapshot.operations.overdue_jobs, 'service job is', 'service jobs are')} overdue`, 'Open jobs have passed their due dates. Check staffing, parts and delivery dates.', '/work-orders')
  if (snapshot.operations?.over_budget_projects > 0) add('projects', 'attention', `${snapshot.operations.over_budget_projects} ${plural(snapshot.operations.over_budget_projects, 'active project is', 'active projects are')} over budget`, 'Review the costs and remaining work for these projects.', '/projects')
  signals.sort((a, b) => Number(a.severity === 'opportunity') - Number(b.severity === 'opportunity'))
  return { currency, sales, previousSales, expenses, growth, forecast, signals }
}

export const QUICK_QUESTIONS = ['How are sales trending?', 'What is the sales forecast?', 'What needs restocking?', 'How much is owed on sales?', 'How are expenses changing?', 'What needs attention?']

export function answerBusinessQuestion(question, snapshot, analysis) {
  const q = String(question || '').toLowerCase().trim().slice(0, 300)
  const m = value => money(value, analysis.currency)
  const unavailable = 'That information is outside your enabled modules or access permissions.'
  if (/forecast|predict|next (month|30)/.test(q)) {
    if (!analysis.forecast) return unavailable
    const f = analysis.forecast
    return f.status === 'ready' ? `Estimated net sales from ${f.from} to ${f.through}: ${m(f.total)}. ${f.label} performed best in the recent 14-day check, with a mean daily error of ${m(f.dailyError)}. This is an estimate based on recorded sales, not a guarantee.` : f.message
  }
  if (/restock|stock|inventory/.test(q)) {
    if (!snapshot.inventory) return unavailable
    const stock = snapshot.inventory
    return stock.low_count ? `${stock.low_count} ${plural(stock.low_count, 'product is', 'products are')} at or below reorder level. ${stock.low_items.map(p => `${p.name}: ${p.available} available (reorder level ${p.reorder_level})`).join('; ')}.${stock.low_count > stock.low_items.length ? ' Open Inventory for the full list.' : ''}` : 'No tracked active products are at or below their reorder level.'
  }
  if (/owed|receivable|outstanding|debt/.test(q)) return snapshot.sales_receivables === null ? unavailable : `${m(snapshot.sales_receivables)} is outstanding on recorded sales across all dates. This excludes customer opening balances, service jobs and project invoices.`
  if (/expense|spend|cost/.test(q)) return analysis.expenses === null ? unavailable : `Recorded expenses total ${m(analysis.expenses)} over the latest 30 complete days. This is recorded spending, not total business cost or profit. Open Finance to review the entries.`
  if (/sale|revenue|trend/.test(q)) return analysis.sales === null ? unavailable : `Net sales were ${m(analysis.sales)} in the latest 30 complete days and ${m(analysis.previousSales)} in the preceding 30.${analysis.growth === null ? ' There is no non-zero earlier baseline for a percentage comparison.' : ` That is ${Math.abs(analysis.growth).toFixed(1)}% ${analysis.growth >= 0 ? 'higher' : 'lower'}.`} Sales include tax and deduct recorded refunds from the original sale date.`
  if (/attention|priority|priorities|risk|summary|how.*business/.test(q)) return analysis.signals.length ? analysis.signals.slice(0, 3).map(item => `${item.title}. ${item.detail}`).join('\n\n') : 'No priority signals were found in the data you can access. Check the reports and history coverage before drawing conclusions about overall business health.'
  return 'Ask about sales trends, the next 30-day sales forecast, stock levels, outstanding sales balances, expenses or current priorities. Answers use the snapshot shown on this page.'
}
