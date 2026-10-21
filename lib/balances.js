export function openingBalanceDue(party) {
  return Math.max(0, Number(party?.opening_balance || 0) - Number(party?.opening_balance_paid || 0))
}

export function salesBalanceDue(sale) {
  return Math.max(0, Number(sale?.total_amount || 0) - Number(sale?.refunded_amount || 0) - Number(sale?.amount_paid || 0))
}

export function customerBalanceMap(rows) {
  return Object.fromEntries(rows.map(row => [row.customer_id, Number(row.balance_due || 0)]))
}

export function purchasePayable(purchase) {
  if (['draft','pending_approval','rejected','cancelled'].includes(purchase?.status)
    || !['not_required','approved'].includes(purchase?.approval_status)) return 0
  return Math.max(0, Number(purchase.total_amount || 0) - Number(purchase.amount_paid || 0))
}
