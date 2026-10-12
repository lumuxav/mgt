export function returnsAsOf(returns, endDate) {
  return returns.filter(row => String(row.created_at || '').slice(0, 10) <= endDate)
}

export function refundedBySale(returns) {
  const map = {}
  for (const row of returns) map[row.sale_id] = (map[row.sale_id] || 0) + Number(row.total_amount || 0)
  return map
}

export function returnedByItem(items) {
  const map = {}
  for (const row of items) map[row.sale_item_id] = (map[row.sale_item_id] || 0) + Number(row.quantity || 0)
  return map
}

export function netItemCost(items, quantities) {
  return items.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0) - Number(quantities[row.id] || 0)) * Number(row.unit_cost || 0), 0)
}
