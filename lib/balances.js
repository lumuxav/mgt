export function openingBalanceDue(party) {
  return Math.max(0, Number(party?.opening_balance || 0) - Number(party?.opening_balance_paid || 0))
}

export function salesBalanceDue(sale) {
  return Math.max(0, Number(sale?.total_amount || 0) - Number(sale?.refunded_amount || 0) - Number(sale?.amount_paid || 0))
}

export function customerBalanceMap(rows) {
  return Object.fromEntries(rows.map(row => [row.customer_id, Number(row.balance_due || 0)]))
}
